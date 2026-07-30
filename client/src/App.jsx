//const API_BASE_URL =
  //'https://asset-automation.cfapps.eu10-005.hana.ondemand.com'
import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'

const readJsonResponse = async (response) => {
  const text = await response.text()
  if (!text) return {}

  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Server returned an invalid JSON response (${response.status}).`)
  }
}

const initialGoodsIssue = {
  GrnNumber: '',
  ProductGroup: '',
  PurchaseOrderDescription: '',
  GoodsMovementCode: '03',
  PostingDate: '',
  DocumentDate: '',
  MaterialDocumentHeaderText: '',
  Material: '',
  Plant: 'IN07',
  StorageLocation: 'IN07',
  GoodsMovementType: '241',
  WBSElement: '',
  InventorySpecialStockType: '',
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
  const [activeTab, setActiveTab] = useState('launch')
  const [goodsIssue, setGoodsIssue] = useState(initialGoodsIssue)
  const [asset, setAsset] = useState(initialAsset)
  const [status, setStatus] = useState({ type: 'idle', message: '' })
  const [result, setResult] = useState(null)
  const [errorDetail, setErrorDetail] = useState(null)
  const [resumeAssetNumbers, setResumeAssetNumbers] = useState([])
  const [projectStockReadOnly, setProjectStockReadOnly] = useState(true)
  const [grnLoading, setGrnLoading] = useState(false)
  const [transferLoading, setTransferLoading] = useState(false)
  const [projectStockTransfer, setProjectStockTransfer] = useState(null)
  /* AUTOMATION DISABLED: Uncomment this block to restore automatic GRN processing.
  const [todayGrns, setTodayGrns] = useState([])
  const [automaticallyProcessed, setAutomaticallyProcessed] = useState([])
  const [bulkResult, setBulkResult] = useState(null)
  const [monitorLoading, setMonitorLoading] = useState(false)
  const [bulkProcessing, setBulkProcessing] = useState(false)
  */
  const [grnInfo, setGrnInfo] = useState({
    productGroup: '',
    assetClass: '',
    poDescription: '',
    mappingError: '',
  })

  const assetNumbers = useMemo(() => result?.assetNumbers || [], [result])
  const serialNumbers = useMemo(() => parseSerialNumbers(goodsIssue.SerialNumbers), [goodsIssue.SerialNumbers])
  const isProjectStock = String(goodsIssue.InventorySpecialStockType || '').trim().toUpperCase() === 'Q'
  const projectStockTransferCompleted = Boolean(projectStockTransfer?.transferPosting?.materialDocument)
  const createDisabled = status.type === 'running'
    || grnLoading
    || transferLoading
    || (isProjectStock && !projectStockTransferCompleted)

  const applyGrnDetails = (body) => {
    const items = Array.isArray(body.items) ? body.items : []
    const firstItem = items[0] || {}
    const itemSerialNumbers = items.flatMap((item) => item.serialNumbers || [])
    const fetchedSerialNumbers = body.serialNumbers?.length ? body.serialNumbers : itemSerialNumbers
    const fetchedQuantity = body.quantity ?? items.reduce((total, item) => total + Number(item.quantity || 0), 0)
    const fetchedMaterials = [...new Set(items.map((item) => item.material).filter(Boolean))]
    const fetchedMaterial = body.material || fetchedMaterials.join(', ')
    const inventorySpecialStockType = body.inventorySpecialStockType || firstItem.inventorySpecialStockType || ''
    const wbsElement = inventorySpecialStockType
      ? body.wbsElement || firstItem.wbsElement || ''
      : ''

    setGoodsIssue((current) => ({
      ...current,
      ProductGroup: body.productGroup || '',
      PurchaseOrderDescription: body.poDescription || '',
      PostingDate: body.postingDate || firstItem.postingDate || '',
      DocumentDate: body.documentDate || firstItem.documentDate || '',
      Material: fetchedMaterial,
      Plant: body.plant || firstItem.plant || current.Plant,
      StorageLocation: body.storageLocation || firstItem.storageLocation || current.StorageLocation,
      EntryUnit: body.entryUnit || firstItem.entryUnit || current.EntryUnit || 'EA',
      QuantityInEntryUnit: fetchedQuantity > 0 ? String(fetchedQuantity) : '',
      SerialNumbers: fetchedSerialNumbers.join('\n'),
      InventorySpecialStockType: inventorySpecialStockType,
      WBSElement: wbsElement,
    }))
    setProjectStockReadOnly(true)
    setAsset((current) => ({
      ...current,
      AssetClass: body.assetClass || current.AssetClass,
      _General: {
        ...current._General,
        FixedAssetDescription: body.poDescription || current._General.FixedAssetDescription,
        AssetAdditionalDescription: body.poDescription || current._General.AssetAdditionalDescription,
        AssetSerialNumber: fetchedSerialNumbers[0] || '',
      },
      _Ledger: [{ ...current._Ledger[0], AssetCapitalizationDate: body.postingDateISO }],
    }))
    setGrnInfo({
      productGroup: body.productGroup || '',
      assetClass: body.assetClass || '',
      poDescription: body.poDescription || '',
      mappingError: body.mappingError || '',
    })
  }

  const getGrn = async () => {
    if (!goodsIssue.GrnNumber.trim()) {
      setStatus({ type: 'warning', message: 'Enter a GRN number before fetching details.' })
      return
    }

    setGrnLoading(true)
    setResult(null)
    setErrorDetail(null)
    setProjectStockTransfer(null)
    setResumeAssetNumbers([])
    try {
      //const response = await fetch(`${API_BASE_URL}/api/grn-details`, {
        const response = await fetch(`/api/grn-details`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grnNumber: goodsIssue.GrnNumber }),
      })
      const body = await readJsonResponse(response)
      if (!response.ok) {
        throw new Error(body.error || 'Could not fetch GRN details.')
      }

      const fetchedSerialNumbers = body.serialNumbers?.length
        ? body.serialNumbers
        : (body.items || []).flatMap((item) => item.serialNumbers || [])
      applyGrnDetails(body)
      const fetchedQuantity = body.quantity ?? (body.items || []).reduce(
        (total, item) => total + Number(item.quantity || 0),
        0,
      )
      const stockType = String(body.inventorySpecialStockType || body.items?.[0]?.inventorySpecialStockType || '').trim()
      setStatus({
        type: 'success',
        message: fetchedSerialNumbers.length === 0
          ? `Loaded GRN ${body.grnNumber}\n\nNo serial numbers maintained for this GRN.\n\nQuantity: ${fetchedQuantity}\n\nOne Fixed Asset will be created for the total quantity.`
          : `Loaded GRN ${body.grnNumber}\n\n${fetchedSerialNumbers.length} serial numbers found for this GRN.\n\nAsset creation will be done for each serial number.${stockType === 'Q' ? '\n\nPost the 411 Project Stock transfer before creating assets.' : ''}`,
      })
    } catch (error) {
      setStatus({ type: 'warning', message: error.message })
    } finally {
      setGrnLoading(false)
    }
  }

  /* AUTOMATION DISABLED: Uncomment this block to restore automatic GRN monitoring.
  const getTodayGrns = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setMonitorLoading(true)
    try {
      //const response = await fetch(`${API_BASE_URL}/api/today-grns`, {
        const response = await fetch(`http://localhost:4000/api/today-grns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
      const body = await readJsonResponse(response)
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
  */

  const setGoods = (field, value) => {
    const transferSensitiveFields = new Set([
      'GrnNumber',
      'PostingDate',
      'DocumentDate',
      'Material',
      'Plant',
      'StorageLocation',
      'WBSElement',
      'InventorySpecialStockType',
      'EntryUnit',
      'QuantityInEntryUnit',
      'SerialNumbers',
    ])
    if (transferSensitiveFields.has(field)) setProjectStockTransfer(null)
    setGoodsIssue((current) => ({ ...current, [field]: value }))
  }
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
  const setGrnInfoField = (field, value) =>
    setGrnInfo((current) => ({ ...current, [field]: value }))
  const setFirstSerialNumber = (value) => {
    setAssetSection('_General', 'AssetSerialNumber', value)
    setProjectStockTransfer(null)
    setGoodsIssue((current) => {
      const values = parseSerialNumbers(current.SerialNumbers)
      if (values.length > 0) values[0] = value
      else if (value) values.push(value)
      return { ...current, SerialNumbers: values.join('\n') }
    })
  }
  const transferProjectStock = async () => {
    setErrorDetail(null)
    setTransferLoading(true)
    setProjectStockTransfer(null)
    setStatus({ type: 'running', message: 'Posting the 411 Project Stock transfer...' })

    try {
      const response = await fetch(`/api/transfer-project-stock`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ goodsIssue }),
      })
      const body = await readJsonResponse(response)

      if (!response.ok) {
        const error = new Error(body.error || 'Project stock transfer failed.')
        error.detail = body.detail
        error.failedPayload = body.failedPayload
        throw error
      }

      setProjectStockTransfer(body)
      setStatus({
        type: 'success',
        message: `411 transfer posted. Material Document ${body.transferPosting?.materialDocument || ''} is ready for review.`,
      })
    } catch (error) {
      setStatus({ type: 'error', message: error.message })
      setErrorDetail({
        detail: error.detail,
        failedPayload: error.failedPayload,
      })
    } finally {
      setTransferLoading(false)
    }
  }
  const createAll = async () => {
    setResult(null)
    setErrorDetail(null)

    if (isProjectStock && !projectStockTransferCompleted) {
      setStatus({
        type: 'warning',
        message: 'Post and review the 411 Project Stock transfer before creating assets.',
      })
      return
    }

    if (goodsIssue.GoodsMovementType === '241' && !goodsIssue.MasterFixedAsset.trim()) {
      window.alert('Asset number is mandatory for movement type 241. The created asset number will be assigned automatically.')
    }

    // const quantity = Number(goodsIssue.QuantityInEntryUnit)
    // if (!Number.isInteger(quantity) || quantity < 1 || serialNumbers.length !== quantity) {
    //   setStatus({
    //     type: 'warning',
    //     message: 'Fetch a GRN with one serial number for each unit before creating assets.',
    //   })
    //   return
    // }

    const quantity = Number(goodsIssue.QuantityInEntryUnit)
const isNonSerial = serialNumbers.length === 0

if (
  !Number.isInteger(quantity) ||
  quantity < 1 ||
  (!isNonSerial && serialNumbers.length !== quantity)
) {
  setStatus({
    type: 'warning',
    message: 'Fetch a GRN with one serial number for each unit before creating assets.',
  })
  return
}

    setStatus({
      type: 'running',
      message: serialNumbers.length === 0
        ? 'Creating asset and posting the full GRN quantity...'
        : 'Creating assets and posting the 241 goods issue...',
    })

    try {
      //const response = await fetch(`${API_BASE_URL}/api/create-goods-issue-with-assets`, {
       const response = await fetch(`/api/create-goods-issue-with-assets`, {

        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          goodsIssue,
          asset,
          resumeAssetNumbers,
          projectStockTransferCompleted: isProjectStock && projectStockTransferCompleted,
          projectStockTransferMaterialDocument: projectStockTransfer?.transferPosting?.materialDocument || '',
        }),
      })
      const body = await readJsonResponse(response)

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
        message: body.serialNumbers?.length === 0
          ? 'Asset created successfully. The total GRN quantity and value were posted to one asset.'
          : `${body.assetNumbers.length} assets created successfully.`,
      })
      setActiveTab('manualGoods')
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

  /* AUTOMATION DISABLED: Uncomment this block to restore bulk automatic asset creation.
  const createPendingAssets = async () => {
    setBulkProcessing(true)
    setBulkResult(null)
    setStatus({ type: 'running', message: 'Creating assets for pending GRNs...' })

    try {
      //const response = await fetch(`${API_BASE_URL}/api/process-pending-grns`, {
       const response = await fetch(`http://localhost:4000/api/process-pending-grns`, {

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
  */

  const openAssetCreation = () => {
    setAsset((current) => ({
      ...current,
      _General: { ...current._General, BaseUnitSAPCode: 'EA', BaseUnitISOCode: 'EA' },
    }))
    setActiveTab('manualAssets')
  }

  const isManualPage = activeTab === 'manualGoods' || activeTab === 'manualAssets'

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">SAP Fiori Asset Automation</p>
            <h1>{activeTab === 'automatic' ? 'Automatic GRN Processing' : isManualPage ? 'Manual Asset Processing' : 'Asset Upload Automation'}</h1>
          </div>
          <div className="topbar-actions">
            {activeTab !== 'launch' ? (
              <button className="secondary" type="button" onClick={() => setActiveTab('launch')}>
                Home
              </button>
            ) : null}
            {isManualPage ? (
              <button className="primary" type="button" onClick={createAll} disabled={createDisabled}>
                {status.type === 'running' ? 'Creating...' : grnLoading ? 'Fetching GRN...' : 'Create Assets'}
              </button>
            ) : null}
          </div>
        </header>

        {activeTab === 'launch' ? (
          <section className="launch-grid" aria-label="Process selection">
            <button className="launch-tile" type="button" onClick={() => setActiveTab('manualGoods')}>
              <span className="tile-kicker">Manual Process</span>
              <strong>Enter GRN and create asset flow</strong>
              <small>Fetch GRN details, create assets, post goods issue, and map material group to asset class.</small>
            </button>
            {/* AUTOMATION DISABLED: Uncomment this tile with the automatic-process panel below.
            <button className="launch-tile" type="button" onClick={() => setActiveTab('automatic')}>
              <span className="tile-kicker">Automatic Process</span>
              <strong>Today GRNs and scheduler results</strong>
              <small>Use the existing automated process controls and monitor success or failure messages.</small>
            </button>
            */}
          </section>
        ) : null}

        {isManualPage ? (
          <nav className="tabs" aria-label="Manual workflow tabs">
            <button type="button" className={activeTab === 'manualGoods' ? 'active' : ''} onClick={() => setActiveTab('manualGoods')}>
              Goods Issue
            </button>
            <button type="button" className={activeTab === 'manualAssets' ? 'active' : ''} onClick={openAssetCreation}>
              Asset Master
            </button>
          </nav>
        ) : null}

        {status.message ? <div className={`status ${status.type}`}>{status.message}</div> : null}
        {activeTab === 'manualGoods' ? (
          <section className="panel object-page">
            <div className="object-header">
              <div>
                <p className="eyebrow">Manual Process</p>
                <h2>Goods Receipt Details</h2>
                <p className="subtle">Fetch GRN details, verify PO description and product group, then create assets.</p>
              </div>
              <button className="secondary" type="button" onClick={openAssetCreation}>
                Asset Master
              </button>
            </div>
            <div className="fiori-section-title">General Information</div>
            <div className="form-grid compact">
              <div className="field-with-action">
                <Field label="GRN Number" value={goodsIssue.GrnNumber} onChange={(value) => setGoods('GrnNumber', value)} required />
                <button className="secondary" type="button" onClick={getGrn} disabled={grnLoading}>
                  {grnLoading ? 'Loading...' : 'Get GRN'}
                </button>
              </div>
              <Field label="Goods Movement Code" value={goodsIssue.GoodsMovementCode} onChange={(value) => setGoods('GoodsMovementCode', value)} required />
              <Field label={grnLoading ? 'Posting Date (loading...)' : 'Posting Date'} value={goodsIssue.PostingDate} onChange={(value) => setGoods('PostingDate', value)} required />
              <Field label={grnLoading ? 'Document Date (loading...)' : 'Document Date'} value={goodsIssue.DocumentDate} onChange={(value) => setGoods('DocumentDate', value)} required />
              <Field label="Header Text" value={goodsIssue.MaterialDocumentHeaderText} onChange={(value) => setGoods('MaterialDocumentHeaderText', value)} />
              <Field label="Material" value={goodsIssue.Material} onChange={(value) => setGoods('Material', value)} required />
              <Field label="Product Group" value={goodsIssue.ProductGroup} onChange={(value) => {
                setGoods('ProductGroup', value)
                setGrnInfoField('productGroup', value)
              }} />
              <Field label="PO Description" value={goodsIssue.PurchaseOrderDescription} onChange={(value) => {
                setGoods('PurchaseOrderDescription', value)
                setGrnInfoField('poDescription', value)
              }} />
              <Field label="Plant" value={goodsIssue.Plant} onChange={(value) => setGoods('Plant', value)} required />
              <Field label="Storage Location" value={goodsIssue.StorageLocation} onChange={(value) => setGoods('StorageLocation', value)} required />
              <Field label="Movement Type" value={goodsIssue.GoodsMovementType} onChange={(value) => setGoods('GoodsMovementType', value)} required />
              <div className="field-with-action">
                <Field label="WBS Element" value={goodsIssue.WBSElement} onChange={(value) => setGoods('WBSElement', value)} readOnly={projectStockReadOnly} />
                <button className="secondary" type="button" onClick={() => setProjectStockReadOnly((current) => !current)}>
                  {projectStockReadOnly ? 'Edit' : 'Lock'}
                </button>
              </div>
              <Field label="Inventory Special Stock Type" value={goodsIssue.InventorySpecialStockType} onChange={(value) => setGoods('InventorySpecialStockType', value)} readOnly={projectStockReadOnly} />
              <Field label="Entry Unit" value={goodsIssue.EntryUnit} onChange={(value) => setGoods('EntryUnit', value)} required />
              <Field label="Quantity" type="number" value={goodsIssue.QuantityInEntryUnit} onChange={(value) => setGoods('QuantityInEntryUnit', value)} required />
              <Field label="Master Fixed Asset" value={goodsIssue.MasterFixedAsset} onChange={(value) => setGoods('MasterFixedAsset', value)} required />
              <Field label="Serial Numbers" value={goodsIssue.SerialNumbers} onChange={(value) => setGoods('SerialNumbers', value)} required multiline />
            </div>
            {grnInfo.mappingError ? <div className="inline-warning">{grnInfo.mappingError}</div> : null}
            {isProjectStock ? (
              <div className="project-stock-actions">
                <div>
                  <p className="eyebrow">Project Stock</p>
                  <h2>Transfer Project Stock</h2>
                  <p className="subtle">Post movement type 411 and review the resulting material document before asset creation.</p>
                </div>
                <button
                  className="primary"
                  type="button"
                  onClick={transferProjectStock}
                  disabled={transferLoading || grnLoading || status.type === 'running'}
                >
                  {transferLoading ? 'Posting 411...' : projectStockTransferCompleted ? 'Repost 411 Transfer' : 'Transfer Project Stock (411)'}
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {/* AUTOMATION DISABLED: Uncomment this panel to restore automatic GRN controls.
        {activeTab === 'automatic' ? (
          <section className="panel list-report">
            <div className="variant-bar">
              <button className="variant-title" type="button">Standard</button>
              <div className="search-wrap">
                <input aria-label="Search" placeholder="Search" />
              </div>
              <button className="primary" type="button" onClick={() => getTodayGrns()} disabled={monitorLoading}>
                {monitorLoading ? 'Loading...' : 'Go'}
              </button>
            </div>
            <div className="panel-actions table-toolbar">
              <div>
                <h2>ASSET UPLOAD automations</h2>
                <span className="view-name">Standard</span>
              </div>
              <div>
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
        */}

        {activeTab === 'manualAssets' ? (
          <section className="panel object-page">
            <div className="object-header">
              <div>
                <p className="eyebrow">Manual Process</p>
                <h2>Fixed Asset</h2>
                <p className="subtle">Asset class, description, and capitalization date reflect the fetched GRN details.</p>
              </div>
              <button className="secondary" type="button" onClick={() => setActiveTab('manualGoods')}>
                Goods Issue
              </button>
            </div>
            <div className="fiori-section-title">Asset Master Data</div>
            <div className="form-grid compact">
              <Field label="Company Code" value={asset.CompanyCode} onChange={(value) => setAssetTop('CompanyCode', value)} required />
              <Field label="Product Group" value={grnInfo.productGroup} onChange={(value) => {
                setGrnInfoField('productGroup', value)
                setGoods('ProductGroup', value)
              }} />
              <Field label="Asset Class" value={asset.AssetClass} onChange={(value) => setAssetTop('AssetClass', value)} required />
              <Field label="PO Description" value={grnInfo.poDescription} onChange={(value) => {
                setGrnInfoField('poDescription', value)
                setGoods('PurchaseOrderDescription', value)
              }} />
              <Field label="Description" value={asset._General.FixedAssetDescription} onChange={(value) => setAssetSection('_General', 'FixedAssetDescription', value)} required />
              <Field label="Additional Description" value={asset._General.AssetAdditionalDescription} onChange={(value) => setAssetSection('_General', 'AssetAdditionalDescription', value)} />
              <Field label="Serial Number (first GRN item)" value={asset._General.AssetSerialNumber} onChange={setFirstSerialNumber} required />
              <Field label="Base Unit of Measure" value={asset._General.BaseUnitSAPCode} onChange={(value) => {
                setAssetSection('_General', 'BaseUnitSAPCode', value)
                setAssetSection('_General', 'BaseUnitISOCode', value)
              }} required />
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

          </section>
        ) : null}

        {projectStockTransferCompleted ? (
          <section className="result transfer-result">
            <h2>Transfer Posting Details</h2>
            <div className="detail-grid">
              <span>Movement Type</span>
              <strong>{projectStockTransfer.transferPosting.movementType}</strong>
              <span>Material Document</span>
              <strong>{projectStockTransfer.transferPosting.materialDocument}</strong>
              <span>Material</span>
              <strong>{projectStockTransfer.transferPosting.material || '-'}</strong>
              <span>Plant</span>
              <strong>{projectStockTransfer.transferPosting.plant || '-'}</strong>
              <span>Storage Location</span>
              <strong>{projectStockTransfer.transferPosting.storageLocation || '-'}</strong>
              <span>Quantity</span>
              <strong>{projectStockTransfer.transferPosting.quantity} {projectStockTransfer.transferPosting.entryUnit || ''}</strong>
              <span>Serial Numbers</span>
              <strong>{projectStockTransfer.transferPosting.serialNumbers?.join(', ') || '-'}</strong>
              <span>Posting Date</span>
              <strong>{projectStockTransfer.transferPosting.postingDate || '-'}</strong>
            </div>
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
