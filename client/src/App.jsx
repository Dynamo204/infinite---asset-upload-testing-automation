import { useEffect, useMemo, useState } from 'react'
import './App.css'

const initialGoodsIssue = {
  GrnNumber: '',
  GoodsMovementCode: '03',
  PostingDate: '',
  DocumentDate: '',
  MaterialDocumentHeaderText: 'Goods Issue to Asset',
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
  AssetClass: '3300',
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

function App() {
  const [activeTab, setActiveTab] = useState('goods')
  const [goodsIssue, setGoodsIssue] = useState(initialGoodsIssue)
  const [asset, setAsset] = useState(initialAsset)
  const [status, setStatus] = useState({ type: 'idle', message: '' })
  const [result, setResult] = useState(null)
  const [errorDetail, setErrorDetail] = useState(null)
  const [resumeAssetNumbers, setResumeAssetNumbers] = useState([])
  const [grnLoading, setGrnLoading] = useState(false)

  const assetNumbers = useMemo(() => result?.assetNumbers || [], [result])
  const serialNumbers = useMemo(() => parseSerialNumbers(goodsIssue.SerialNumbers), [goodsIssue.SerialNumbers])

  useEffect(() => {
    if (!goodsIssue.GrnNumber.trim()) return undefined

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setGrnLoading(true)
      try {
        const response = await fetch('/api/grn-details', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ grnNumber: goodsIssue.GrnNumber }),
          signal: controller.signal,
        })
        const body = await response.json()
        if (!response.ok) {
          const message = response.status === 404
            ? 'The GRN API is not available. Restart the app with npm run dev.'
            : body.error || 'Could not fetch GRN details.'
          throw new Error(message)
        }

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
        setStatus({ type: 'success', message: `Loaded GRN ${body.grnNumber}: ${body.quantity} serial-managed item(s).` })
      } catch (error) {
        if (error.name !== 'AbortError') {
          setStatus({ type: 'warning', message: error.message })
        }
      } finally {
        if (!controller.signal.aborted) setGrnLoading(false)
      }
    }, 400)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [goodsIssue.GrnNumber])

  const goodsPayload = useMemo(
    () => ({
      GoodsMovementCode: goodsIssue.GoodsMovementCode,
      PostingDate: goodsIssue.PostingDate,
      DocumentDate: goodsIssue.DocumentDate,
      MaterialDocumentHeaderText: goodsIssue.MaterialDocumentHeaderText,
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
      const response = await fetch('/api/create-goods-issue-with-assets', {
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
            {status.type === 'running' ? 'Creating...' : grnLoading ? 'Fetching GRN...' : 'Create All'}
          </button>
        </header>

        <nav className="tabs" aria-label="Workflow tabs">
          <button type="button" className={activeTab === 'goods' ? 'active' : ''} onClick={() => setActiveTab('goods')}>
            Goods Issue
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
              <Field label="GRN Number" value={goodsIssue.GrnNumber} onChange={(value) => setGoods('GrnNumber', value)} required />
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
        ) : (
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
        )}

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
