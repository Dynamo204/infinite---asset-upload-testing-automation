const API_BASE_URL =
  'https://asset-automation.cfapps.eu10-005.hana.ondemand.com'
import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'

const initialGoodsIssue = {
  GrnNumber: '',
  GoodsMovementCode: '03',
  PostingDate: '',
  DocumentDate: '',
  MaterialDocumentHeaderText: '',
  Material: '',
  Plant: 'IN07',
  StorageLocation: 'IN07',
  GoodsMovementType: '241',
  EntryUnit: 'EA',
  QuantityInEntryUnit: '',
  MasterFixedAsset: '',
  SerialNumbers: '',
}

const initialAsset = {
  CompanyCode: '1000',
  AssetClass: '3100',
  _General: {
    FixedAssetDescription: 'Office equipments - Others',
    AssetAdditionalDescription: 'Office equipments - Others',
    AssetSerialNumber: '1000110110',
    BaseUnitSAPCode: 'EA',
    BaseUnitISOCode: 'EA',
  },
  _AccountAssignment: {
    CostCenter: '1000110110',
    Plant: 'IN09',
  },
  _Inventory: {
    Inventory: '1000110110',
  },
  _Ledger: [
    {
      Ledger: '0L',
      AssetCapitalizationDate: '',
      _Valuation: [
        {
          AssetDepreciationArea: '01',
          DepreciationStartDate: '2026-04-01',
          _TimeBasedValuation: [
            {
              ValidityStartDate: '2026-04-01',
              PlannedUsefulLifeInYears: '10',
            },
          ],
        },
      ],
    },
  ],
}

const parseSerialNumbers = (value) =>
  String(value || '')
    .split(/[\s,;]+/)
    .map((serialNumber) => serialNumber.trim())
    .filter(Boolean)

const Field = ({ label, value, onChange, required, type = 'text', readOnly = false, multiline = false }) => (
  <label className="field">
    <span>
      {label}
      {required ? <b>*</b> : null}
    </span>
    {multiline ? (
      <textarea value={value} readOnly={readOnly} rows={4} onChange={(event) => onChange(event.target.value)} />
    ) : (
      <input
        type={type}
        value={value}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
      />
    )}
  </label>
)

const Payload = ({ title, value }) => (
  <details className="payload" open>
    <summary>{title}</summary>
    <pre>{JSON.stringify(value, null, 2)}</pre>
  </details>
)

const formatDateTime = (value) => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

const formatInventoryBalance = (balance) => {
  if (!balance) return '-'
  if (balance.error || balance.unavailable) return 'Not available'
  if (balance.quantity === null || balance.quantity === undefined) return '-'
  return `${balance.quantity} ${balance.unit || ''}`.trim()
}

const statusClass = (status) => {
  if (status === 'Pending') return 'pending'
  if (status === 'Failed') return 'failed'
  return 'done'
}

const statusLabel = (status) => {
  if (status === 'Asset Already Exists') return 'Asset Already Created'
  return status
}

const SerialAssetList = ({ pairs = [], assetNumbers = [] }) => {
  const rows = pairs.length
    ? pairs
    : assetNumbers.map((assetNumber, index) => ({ serialNumber: `#${index + 1}`, assetNumber }))

  if (!rows.length) return <span className="muted">No asset numbers yet.</span>

  return (
    <div className="asset-pairs">
      {rows.map((pair, index) => (
        <span key={`${pair.serialNumber || index}-${pair.assetNumber || 'pending'}`}>
          <b>{pair.serialNumber}</b>
          {pair.assetNumber || 'Pending'}
        </span>
      ))}
    </div>
  )
}

function App() {
  const [activeTab, setActiveTab] = useState('goods')
  const [goodsIssue, setGoodsIssue] = useState(initialGoodsIssue)
  const [asset, setAsset] = useState(initialAsset)
  const [status, setStatus] = useState({ type: 'idle', message: '' })
  const [result, setResult] = useState(null)
  const [errorDetail, setErrorDetail] = useState(null)
  const [resumeAssetNumbers, setResumeAssetNumbers] = useState([])
  const [grnLoading, setGrnLoading] = useState(false)
  const [todayGrns, setTodayGrns] = useState([])
  const [automaticallyProcessed, setAutomaticallyProcessed] = useState([])
  const [bulkResult, setBulkResult] = useState(null)
  const [monitorLoading, setMonitorLoading] = useState(false)
  const [bulkProcessing, setBulkProcessing] = useState(false)

  const assetNumbers = useMemo(() => result?.assetNumbers || [], [result])
  const serialNumbers = useMemo(() => parseSerialNumbers(goodsIssue.SerialNumbers), [goodsIssue.SerialNumbers])

  const applyGrnDetails = (body) => {
    setGoodsIssue((current) => ({
      ...current,
      PostingDate: body.postingDate,
      DocumentDate: body.documentDate,
      Material: body.material,
      Plant: body.plant,
      StorageLocation: body.storageLocation,
      EntryUnit: body.entryUnit,
      QuantityInEntryUnit: String(body.quantity),
      SerialNumbers: body.serialNumbers.join('\n'),
    }))
    setAsset((current) => ({
      ...current,
      _General: { ...current._General, AssetSerialNumber: body.serialNumbers[0] || '' },
      _Ledger: [{ ...current._Ledger[0], AssetCapitalizationDate: body.postingDateISO }],
    }))
  }

  const getGrn = async () => {
    if (!goodsIssue.GrnNumber.trim()) {
      setStatus({ type: 'warning', message: 'Enter a GRN number before fetching details.' })
      return
    }

    setGrnLoading(true)
    try {
      //const response = await fetch('/api/grn-details', {
      const response = await fetch(`${API_BASE_URL}/api/grn-details`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ grnNumber: goodsIssue.GrnNumber }),
})
      const body = await response.json()
      if (!response.ok) {
        throw new Error(body.error || 'Could not fetch GRN details.')
      }

      applyGrnDetails(body)
      setStatus({ type: 'success', message: `Loaded GRN ${body.grnNumber}: ${body.quantity} serial-managed item(s).` })
    } catch (error) {
      setStatus({ type: 'warning', message: error.message })
    } finally {
      setGrnLoading(false)
    }
  }

  const getTodayGrns = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setMonitorLoading(true)
    try {
      //const response = await fetch('/api/today-grns', {
      const response = await fetch(`${API_BASE_URL}/api/today-grns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not fetch today GRNs.')
      setTodayGrns(body.items || [])
      setAutomaticallyProcessed(body.automaticallyProcessed || [])
      if (!silent) {
        setStatus({ type: 'success', message: `Loaded ${body.items?.length || 0} GRN item(s) for today.` })
      }
    } catch (error) {
      if (!silent) setStatus({ type: 'error', message: error.message })
    } finally {
      if (!silent) setMonitorLoading(false)
    }
  }, [])

  useEffect(() => {
    const initialTimer = window.setTimeout(() => getTodayGrns({ silent: true }), 0)
    const refreshTimer = window.setInterval(() => getTodayGrns({ silent: true }), 30_000)
    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(refreshTimer)
    }
  }, [getTodayGrns])

  const goodsPayload = useMemo(
    () => ({
      GoodsMovementCode: goodsIssue.GoodsMovementCode,
      PostingDate: goodsIssue.PostingDate,
      DocumentDate: goodsIssue.DocumentDate,
      to_MaterialDocumentItem: {
        results: (serialNumbers.length > 0 ? serialNumbers : ['']).map((serialNumber, index) => ({
          Material: goodsIssue.Material,
          Plant: goodsIssue.Plant,
          StorageLocation: goodsIssue.StorageLocation,
          GoodsMovementType: goodsIssue.GoodsMovementType,
          EntryUnit: goodsIssue.EntryUnit,
          QuantityInEntryUnit: '1',
          MasterFixedAsset: assetNumbers[index] || '<created asset will be assigned>',
          to_SerialNumbers: {
            results: serialNumber ? [{ SerialNumber: serialNumber }] : [],
          },
        })),
      },
    }),
    [assetNumbers, goodsIssue, serialNumbers],
  )

  const setGoods = (field, value) => setGoodsIssue((current) => ({ ...current, [field]: value }))
  const setAssetTop = (field, value) => setAsset((current) => ({ ...current, [field]: value }))
  const setAssetSection = (section, field, value) =>
    setAsset((current) => ({ ...current, [section]: { ...current[section], [field]: value } }))
  const setLedger = (field, value) =>
    setAsset((current) => ({
      ...current,
      _Ledger: [{ ...current._Ledger[0], [field]: value }],
    }))
  const setValuation = (field, value) =>
    setAsset((current) => ({
      ...current,
      _Ledger: [
        {
          ...current._Ledger[0],
          _Valuation: [{ ...current._Ledger[0]._Valuation[0], [field]: value }],
        },
      ],
    }))
  const setTimeValuation = (field, value) =>
    setAsset((current) => ({
      ...current,
      _Ledger: [
        {
          ...current._Ledger[0],
          _Valuation: [
            {
              ...current._Ledger[0]._Valuation[0],
              _TimeBasedValuation: [
                { ...current._Ledger[0]._Valuation[0]._TimeBasedValuation[0], [field]: value },
              ],
            },
          ],
        },
      ],
    }))
  const createAll = async () => {
    setResult(null)
    setErrorDetail(null)

    if (goodsIssue.GoodsMovementType === '241' && !goodsIssue.MasterFixedAsset.trim()) {
      window.alert('Asset number is mandatory for movement type 241. The created asset number will be assigned automatically.')
    }

    const quantity = Number(goodsIssue.QuantityInEntryUnit)
    if (!Number.isInteger(quantity) || quantity < 1 || serialNumbers.length !== quantity) {
      setStatus({
        type: 'warning',
        message: 'Fetch a GRN with one serial number for each unit before creating assets.',
      })
      return
    }

    setStatus({ type: 'running', message: 'Creating assets and posting the 241 goods issue...' })

    try {
       //const response = await fetch('/api/create-goods-issue-with-assets', {
      const response = await fetch(`${API_BASE_URL}/api/create-goods-issue-with-assets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ goodsIssue, asset, resumeAssetNumbers }),
      })
      const body = await response.json()

      if (!response.ok) {
        const error = new Error(body.error || 'Create process failed.')
        error.detail = body.detail
        error.failedPayload = body.failedPayload
        error.partialResult = body.partialResult
        throw error
      }

      setResult(body)
      setResumeAssetNumbers([])
      setGoodsIssue((current) => ({ ...current, MasterFixedAsset: body.assetNumbers.join(', ') }))
      setStatus({
        type: 'success',
        message: `Created ${body.assetNumbers.length} assets and posted the goods issue.`,
      })
      setActiveTab('goods')
    } catch (error) {
      const partialAssetNumbers = error.partialResult?.assetNumbers || []
      const recoverableAssets = partialAssetNumbers.length === quantity
        ? partialAssetNumbers
        : []
      if (recoverableAssets.length > 0) {
        setResumeAssetNumbers(recoverableAssets)
        setGoodsIssue((current) => ({ ...current, MasterFixedAsset: recoverableAssets.join(', ') }))
      }
      setStatus({ type: 'error', message: error.message })
      setErrorDetail({
        detail: error.detail,
        failedPayload: error.failedPayload,
        partialResult: error.partialResult,
      })
    }
  }

  const createPendingAssets = async () => {
    setBulkProcessing(true)
    setBulkResult(null)
    setStatus({ type: 'running', message: 'Creating assets for pending GRNs...' })

    try {
      //const response = await fetch('/api/process-pending-grns', {
      const response = await fetch(`${API_BASE_URL}/api/process-pending-grns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
      const body = await response.json()
      if (!response.ok) {
        throw new Error(body.error || 'Could not process pending GRNs.')
      }

      setBulkResult(body)
      setTodayGrns(body.monitor?.items || [])
      setAutomaticallyProcessed(body.monitor?.automaticallyProcessed || [])
      setStatus({
        type: body.failure?.length ? 'warning' : 'success',
        message: `Processed ${body.success?.length || 0} GRN item(s), skipped ${body.skipped?.length || 0}.`,
      })
    } catch (error) {
      setStatus({ type: 'error', message: error.message })
    } finally {
      setBulkProcessing(false)
    }
  }

  const openAssetCreation = () => {
    setAsset((current) => ({
      ...current,
      _General: { ...current._General, BaseUnitSAPCode: 'EA', BaseUnitISOCode: 'EA' },
    }))
    setActiveTab('assets')
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">SAP Asset Flow</p>
            <h1>Goods Issue with Asset Creation</h1>
          </div>
          <button className="primary" type="button" onClick={createAll} disabled={status.type === 'running' || grnLoading}>
            {status.type === 'running' ? 'Creating...' : grnLoading ? 'Fetching GRN...' : 'Create Assets'}
          </button>
        </header>

        <nav className="tabs" aria-label="Workflow tabs">
          <button type="button" className={activeTab === 'goods' ? 'active' : ''} onClick={() => setActiveTab('goods')}>
            Goods Issue
          </button>
          <button type="button" className={activeTab === 'monitor' ? 'active' : ''} onClick={() => setActiveTab('monitor')}>
            Today GRNs
          </button>
          <button type="button" className={activeTab === 'assets' ? 'active' : ''} onClick={openAssetCreation}>
            Assets Creation
          </button>
        </nav>

        {status.message ? <div className={`status ${status.type}`}>{status.message}</div> : null}
        {errorDetail?.detail || errorDetail?.failedPayload ? (
          <details className="error-detail" open>
            <summary>SAP error detail</summary>
            <pre>{JSON.stringify(errorDetail, null, 2)}</pre>
          </details>
        ) : null}

        {activeTab === 'goods' ? (
          <section className="panel">
            <div className="form-grid">
              <div className="field-with-action">
                <Field label="GRN Number" value={goodsIssue.GrnNumber} onChange={(value) => setGoods('GrnNumber', value)} required />
                <button className="secondary" type="button" onClick={getGrn} disabled={grnLoading}>
                  {grnLoading ? 'Loading...' : 'Get GRN'}
                </button>
              </div>
              <Field label="Goods Movement Code" value={goodsIssue.GoodsMovementCode} onChange={(value) => setGoods('GoodsMovementCode', value)} required />
              <Field label={grnLoading ? 'Posting Date (loading...)' : 'Posting Date'} value={goodsIssue.PostingDate} onChange={() => {}} required readOnly />
              <Field label={grnLoading ? 'Document Date (loading...)' : 'Document Date'} value={goodsIssue.DocumentDate} onChange={() => {}} required readOnly />
              <Field label="Header Text" value={goodsIssue.MaterialDocumentHeaderText} onChange={(value) => setGoods('MaterialDocumentHeaderText', value)} />
              <Field label="Material" value={goodsIssue.Material} onChange={() => {}} required readOnly />
              <Field label="Plant" value={goodsIssue.Plant} onChange={() => {}} required readOnly />
              <Field label="Storage Location" value={goodsIssue.StorageLocation} onChange={() => {}} required readOnly />
              <Field label="Movement Type" value={goodsIssue.GoodsMovementType} onChange={() => {}} required readOnly />
              <Field label="Entry Unit" value={goodsIssue.EntryUnit} onChange={() => {}} required readOnly />
              <Field label="Quantity" type="number" value={goodsIssue.QuantityInEntryUnit} onChange={() => {}} required readOnly />
              <Field label="Master Fixed Asset" value={goodsIssue.MasterFixedAsset} onChange={(value) => setGoods('MasterFixedAsset', value)} required readOnly={assetNumbers.length > 0} />
              <Field label="Serial Numbers" value={goodsIssue.SerialNumbers} onChange={() => {}} required readOnly multiline />
            </div>
            <Payload title="Goods issue payload" value={goodsPayload} />
          </section>
        ) : null}

        {activeTab === 'monitor' ? (
          <section className="panel">
            <div className="panel-actions">
              <h2>Today's 101 GRNs</h2>
              <div>
                <button className="secondary" type="button" onClick={() => getTodayGrns()} disabled={monitorLoading}>
                  {monitorLoading ? 'Loading...' : 'Get GRNs'}
                </button>
                <button className="primary" type="button" onClick={createPendingAssets} disabled={bulkProcessing || monitorLoading}>
                  {bulkProcessing ? 'Creating...' : 'Create Assets'}
                </button>
              </div>
            </div>

            <div className="table-wrap">
              <table className="grn-table">
                <thead>
                  <tr>
                    <th>GRN Number</th>
                    <th>Item</th>
                    <th>Material</th>
                    <th>Product Group</th>
                    <th>Quantity</th>
                    <th>Inventory Balance</th>
                    <th>Serial Numbers</th>
                    <th>Asset Numbers</th>
                    <th>Plant</th>
                    <th>Storage Location</th>
                    <th>Asset Status</th>
                  </tr>
                </thead>
                <tbody>
                  {todayGrns.length > 0 ? todayGrns.map((item) => (
                    <tr key={item.key}>
                      <td>{item.grnNumber}</td>
                      <td>{item.materialDocumentItem}</td>
                      <td>{item.material}</td>
                      <td>{item.productGroup || '-'}</td>
                      <td>{item.quantity}</td>
                      <td>
                        {formatInventoryBalance(item.inventoryBalance)}
                      </td>
                      <td>{item.serialNumbers?.join(', ') || '-'}</td>
                      <td><SerialAssetList pairs={item.serialAssetPairs} assetNumbers={item.assetNumbers} /></td>
                      <td>{item.plant}</td>
                      <td>{item.storageLocation}</td>
                      <td>
                        <span className={`pill ${statusClass(item.status)}`}>
                          {statusLabel(item.status)}
                        </span>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan="11">No 101 GRN items loaded for today.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {bulkResult ? (
              <div className="result-grid">
                <section>
                  <h2>Success</h2>
                  {bulkResult.success?.length ? bulkResult.success.map((item) => (
                    <div className="message success-line" key={item.key}>
                      <strong>GRN {item.grnNumber} processed successfully</strong>
                      <span>{item.assetNumbers.length} Assets created</span>
                      <span>Balance: {formatInventoryBalance(item.inventoryBalance)}</span>
                      <SerialAssetList pairs={item.serialAssetPairs} assetNumbers={item.assetNumbers} />
                      <span>241 Goods Issue posted</span>
                    </div>
                  )) : <p className="muted">No pending GRNs were processed successfully.</p>}
                </section>
                <section>
                  <h2>Already Created</h2>
                  {bulkResult.skipped?.length ? bulkResult.skipped.map((item) => (
                    <div className="message success-line" key={item.key}>
                      <strong>GRN {item.grnNumber} asset already created</strong>
                      <SerialAssetList pairs={item.serialAssetPairs} assetNumbers={item.assetNumbers} />
                    </div>
                  )) : <p className="muted">No already-created GRNs were skipped.</p>}
                </section>
                <section>
                  <h2>Failure</h2>
                  {bulkResult.failure?.length ? bulkResult.failure.map((item) => (
                    <div className="message failure-line" key={item.key}>
                      <strong>GRN {item.grnNumber} failed</strong>
                      <span>{item.error}</span>
                      <span>Balance: {formatInventoryBalance(item.inventoryBalance)}</span>
                      <SerialAssetList pairs={item.serialAssetPairs} assetNumbers={item.assetNumbers} />
                    </div>
                  )) : <p className="muted">No failures.</p>}
                </section>
              </div>
            ) : null}

            <section className="auto-processed">
              <h2>Automatically Processed</h2>
              {automaticallyProcessed.length ? automaticallyProcessed.map((item) => (
                <div className="message success-line" key={`${item.materialDocument}-${item.materialDocumentItem}-${item.updatedAt}`}>
                  <strong>GRN {item.materialDocument} processed automatically</strong>
                  <span>{item.assetNumbers?.length || 0} Assets Created</span>
                  <span>Balance: {formatInventoryBalance(item.inventoryBalance)}</span>
                  <SerialAssetList assetNumbers={item.assetNumbers} pairs={(item.serialNumbers || []).map((serialNumber, index) => ({
                    serialNumber,
                    assetNumber: item.assetNumbers?.[index] || '',
                  }))} />
                  <span>241 Posted</span>
                  <span>{formatDateTime(item.updatedAt)}</span>
                </div>
              )) : <p className="muted">No scheduler-created assets shown for today yet.</p>}
            </section>
          </section>
        ) : null}

        {activeTab === 'assets' ? (
          <section className="panel">
            <h2>Fixed Asset</h2>
            <div className="form-grid">
              <Field label="Company Code" value={asset.CompanyCode} onChange={(value) => setAssetTop('CompanyCode', value)} required />
              <Field label="Asset Class" value={asset.AssetClass} onChange={(value) => setAssetTop('AssetClass', value)} required />
              <Field label="Description" value={asset._General.FixedAssetDescription} onChange={(value) => setAssetSection('_General', 'FixedAssetDescription', value)} required />
              <Field label="Additional Description" value={asset._General.AssetAdditionalDescription} onChange={(value) => setAssetSection('_General', 'AssetAdditionalDescription', value)} />
              <Field label="Serial Number (first GRN item)" value={asset._General.AssetSerialNumber} onChange={() => {}} required readOnly />
              <Field label="Base Unit of Measure" value={asset._General.BaseUnitSAPCode} onChange={() => {}} required readOnly />
              <Field label="Cost Center" value={asset._AccountAssignment.CostCenter} onChange={(value) => setAssetSection('_AccountAssignment', 'CostCenter', value)} required />
              <Field label="Asset Plant" value={asset._AccountAssignment.Plant} onChange={(value) => setAssetSection('_AccountAssignment', 'Plant', value)} required />
              <Field label="Inventory" value={asset._Inventory.Inventory} onChange={(value) => setAssetSection('_Inventory', 'Inventory', value)} />
              <Field label="Ledger" value={asset._Ledger[0].Ledger} onChange={(value) => setLedger('Ledger', value)} />
              <Field label="Capitalization Date" type="date" value={asset._Ledger[0].AssetCapitalizationDate} onChange={(value) => setLedger('AssetCapitalizationDate', value)} required />
              <Field label="Depreciation Area" value={asset._Ledger[0]._Valuation[0].AssetDepreciationArea} onChange={(value) => setValuation('AssetDepreciationArea', value)} />
              <Field label="Depreciation Start" type="date" value={asset._Ledger[0]._Valuation[0].DepreciationStartDate} onChange={(value) => setValuation('DepreciationStartDate', value)} required />
              <Field label="Validity Start" type="date" value={asset._Ledger[0]._Valuation[0]._TimeBasedValuation[0].ValidityStartDate} onChange={(value) => setTimeValuation('ValidityStartDate', value)} />
              <Field label="Useful Life Years" value={asset._Ledger[0]._Valuation[0]._TimeBasedValuation[0].PlannedUsefulLifeInYears} onChange={(value) => setTimeValuation('PlannedUsefulLifeInYears', value)} />
            </div>

            <Payload title="Asset payload" value={asset} />
          </section>
        ) : null}

        {result ? (
          <section className="result">
            <h2>Created Asset Numbers</h2>
            <div className="asset-list">
              {result.assetNumbers.map((assetNumber) => (
                <span key={assetNumber}>{assetNumber}</span>
              ))}
            </div>
          </section>
        ) : null}
      </section>
    </main>
  )
}

export default App
