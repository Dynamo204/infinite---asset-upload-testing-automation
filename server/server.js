import { createReadStream } from 'node:fs'
import http from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envLocalPath = join(__dirname, '..', '.env')

if (existsSync(envLocalPath)) {
  const envLocal = readFileSync(envLocalPath, 'utf8')
  for (const line of envLocal.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex === -1) continue

    const key = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1).trim()
    process.env[key] ||= value
  }
}

const PORT = Number(process.env.PORT || 4000)
const SAP_BASE_URL = process.env.SAP_BASE_URL || 'https://my434938-api.s4hana.cloud.sap'
const SAP_USERNAME = process.env.SAP_USERNAME
const SAP_PASSWORD = process.env.SAP_PASSWORD
const SAP_AUTH_HEADER = process.env.SAP_AUTH_HEADER
const PO_USERNAME = process.env.PO_USERNAME || process.env.SAP_PO_USERNAME
const PO_PASSWORD = process.env.PO_PASSWORD || process.env.SAP_PO_PASSWORD
const PO_AUTH_HEADER = process.env.PO_AUTH_HEADER || process.env.SAP_PO_AUTH_HEADER
const DEFAULT_SCHEDULER_INTERVAL_MS = 5 * 60 * 1000
const configuredSchedulerInterval = Number(process.env.GRN_SCHEDULER_INTERVAL_MS || DEFAULT_SCHEDULER_INTERVAL_MS)
const SCHEDULER_INTERVAL_MS = Number.isFinite(configuredSchedulerInterval) && configuredSchedulerInterval > 0
  ? configuredSchedulerInterval
  : DEFAULT_SCHEDULER_INTERVAL_MS
const SCHEDULER_ENABLED = process.env.GRN_SCHEDULER_ENABLED !== 'false'
const configuredGrnFetchTop = Number(process.env.GRN_FETCH_TOP || 100)
const GRN_FETCH_TOP = Number.isInteger(configuredGrnFetchTop) && configuredGrnFetchTop > 0
  ? configuredGrnFetchTop
  : 100
const PROCESSED_STORE_PATH = join(__dirname, 'data', 'processed-grn-items.json')

const ENDPOINTS = {
  goodsIssue:
    '/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader',
  materialDocumentItems:
    '/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentItem',
  materialStock:
    '/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV/A_MatlStkInAcctMod',
  product:
    '/sap/opu/odata/sap/API_PRODUCT_SRV/A_Product',
  fixedAssetCollection:
    '/sap/opu/odata4/sap/api_fixedasset/srvd_a2x/sap/fixedasset/0001/FixedAsset',
  fixedAssetCreate:
    '/sap/opu/odata4/sap/api_fixedasset/srvd_a2x/sap/fixedasset/0001/FixedAsset/SAP__self.CreateMasterFixedAsset',
  purchaseOrderItems:
    '/sap/opu/odata4/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001/PurchaseOrderItem',
  assetUploadAutomation:
    '/sap/opu/odata/sap/YY1_ASSETUPLOADAUTOMATION_CDS/YY1_ASSETUPLOADAUTOMATION',
}

const CBO_FIELDS = {
  materialDocument: process.env.CBO_FIELD_MATERIAL_DOCUMENT || 'MaterialDocument',
  materialDocumentItem: process.env.CBO_FIELD_MATERIAL_DOCUMENT_ITEM || 'MaterialDocumentItem',
  material: process.env.CBO_FIELD_MATERIAL || 'Material',
  productGroup: process.env.CBO_FIELD_PRODUCT_GROUP || 'ProductGroup',
  assetClass: process.env.CBO_FIELD_ASSET_CLASS || 'AssetClass',
  plant: process.env.CBO_FIELD_PLANT || 'Plant',
  storageLocation: process.env.CBO_FIELD_STORAGE_LOCATION || 'StorageLocation',
  quantity: process.env.CBO_FIELD_QUANTITY || 'Quantity',
  serialNumbers: process.env.CBO_FIELD_SERIAL_NUMBERS || 'SerialNumbers',
  assetNumbers: process.env.CBO_FIELD_ASSET_NUMBERS || 'AssetNumbers',
  processedStatus: process.env.CBO_FIELD_PROCESSED_STATUS || 'ProcessedStatus',
  errorMessage: process.env.CBO_FIELD_ERROR_MESSAGE || 'ErrorMessage',
  processedOn: process.env.CBO_FIELD_PROCESSED_ON || 'ProcessedOn',
  poDescription: process.env.CBO_FIELD_PO_DESCRIPTION || 'PurchaseOrderItemText',
  source: process.env.CBO_FIELD_SOURCE || 'Source',
}

const PRODUCT_GROUP_ASSET_CLASS = {
  YBFA01: '1000',
  YBFA02: '1100',
  YBFA03: '1200',
  YBFA04: '1500',
  YBFA05: '2000',
  YBFA06: '3000',
  YBFA07: '3100',
  YBFA08: '3200',
  YBFA09: '3210',
  YBFA10: '3300',
  YBFA11: '3400',
  YBFA12: '3300',
}

const defaultAssetTemplate = {
  CompanyCode: process.env.ASSET_COMPANY_CODE || '1000',
  AssetClass: process.env.ASSET_CLASS || '3100',
  _General: {
    FixedAssetDescription: process.env.ASSET_DESCRIPTION || 'Office equipments - Others',
    AssetAdditionalDescription: process.env.ASSET_ADDITIONAL_DESCRIPTION || 'Office equipments - Others',
    AssetSerialNumber: '',
    BaseUnitSAPCode: 'EA',
    BaseUnitISOCode: 'EA',
  },
  _AccountAssignment: {
    CostCenter: process.env.ASSET_COST_CENTER || '1000110110',
    Plant: process.env.ASSET_PLANT || 'IN09',
  },
  _Inventory: {
    Inventory: process.env.ASSET_INVENTORY || '1000110110',
  },
  _Ledger: [
    {
      Ledger: process.env.ASSET_LEDGER || '0L',
      AssetCapitalizationDate: '',
      _Valuation: [
        {
          AssetDepreciationArea: process.env.ASSET_DEPRECIATION_AREA || '01',
          DepreciationStartDate: process.env.ASSET_DEPRECIATION_START_DATE || '',
          _TimeBasedValuation: [
            {
              ValidityStartDate: process.env.ASSET_VALIDITY_START_DATE || '',
              PlannedUsefulLifeInYears: process.env.ASSET_USEFUL_LIFE_YEARS || '10',
            },
          ],
        },
      ],
    },
  ],
}

const readJson = (request) =>
  new Promise((resolve, reject) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
      if (body.length > 1_000_000) {
        request.destroy()
        reject(new Error('Request body is too large.'))
      }
    })
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch {
        reject(new Error('Invalid JSON request body.'))
      }
    })
    request.on('error', reject)
  })

const sendJson = (response, statusCode, payload) => {
  response.writeHead(statusCode, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  })
  response.end(JSON.stringify(payload))
}

const buildBasicAuthHeader = (username, password) => {
  if (!username || !password) return null
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

const getAuthHeader = (options = {}) => {
  if (options.authHeader) return options.authHeader
  if (options.username || options.password) return buildBasicAuthHeader(options.username, options.password)
  if (SAP_AUTH_HEADER) return SAP_AUTH_HEADER
  return buildBasicAuthHeader(SAP_USERNAME, SAP_PASSWORD)
}

const getResponseBody = async (response) => {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const stringifyDetail = (detail) => {
  if (!detail) return ''
  if (typeof detail === 'string') return detail

  const errorMessage = detail?.error?.message
  const messages = [
    typeof errorMessage === 'string' ? errorMessage : errorMessage?.value,
    ...(detail?.error?.innererror?.errordetails || []).map((item) => item.message),
    ...(detail?.['@SAP__common.Messages'] || []).map((item) => item.message),
  ].filter((message) => typeof message === 'string' && message.trim())

  return [...new Set(messages)].join(' | ') || JSON.stringify(detail)
}

const compactText = (value, maxLength = 255) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength)

const getSapErrorDetails = (detail) => detail?.error?.innererror?.errordetails || []

const getStockDeficitMessage = (detail) => {
  const deficits = getSapErrorDetails(detail)
    .filter((item) => item.code === 'M7/021')
    .map((item) => item.message)
    .filter(required)

  if (deficits.length === 0) return null
  return [...new Set(deficits)].join('; ')
}

const cookieHeader = (headers) => {
  if (typeof headers.getSetCookie === 'function') {
    return headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; ')
  }

  return headers
    .get('set-cookie')
    ?.split(',')
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
}

const sapRequest = async (path, method, payload, options = {}) => {
  const auth = getAuthHeader(options)
  if (!auth) {
    throw Object.assign(
      new Error('SAP credentials are missing. Set SAP_USERNAME and SAP_PASSWORD, or SAP_AUTH_HEADER.'),
      { statusCode: 500 },
    )
  }

  const tokenPath = options.tokenPath || path
  const tokenResponse = await fetch(`${SAP_BASE_URL}${tokenPath}`, {
    method: 'GET',
    headers: {
      authorization: auth,
      accept: 'application/json',
      'x-csrf-token': 'Fetch',
    },
  })

  if (!tokenResponse.ok) {
    const detail = await getResponseBody(tokenResponse)
    throw Object.assign(new Error(`Could not fetch SAP CSRF token for ${tokenPath}.`), {
      statusCode: tokenResponse.status,
      detail,
    })
  }

  const csrfToken = tokenResponse.headers.get('x-csrf-token')
  const cookies = cookieHeader(tokenResponse.headers)
  const response = await fetch(`${SAP_BASE_URL}${path}`, {
    method,
    headers: {
      authorization: auth,
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf-token': csrfToken || '',
      ...(cookies ? { cookie: cookies } : {}),
    },
    body: JSON.stringify(payload),
  })

  const body = await getResponseBody(response)
  if (!response.ok) {
    const detailMessage = stringifyDetail(body)
    throw Object.assign(new Error(`SAP request failed for ${path}.${detailMessage ? ` ${detailMessage}` : ''}`), {
      statusCode: response.status,
      detail: body,
      failedPayload: payload,
    })
  }

  return body
}

const sapGet = async (path, options = {}) => {
  const auth = getAuthHeader(options)
  if (!auth) {
    throw Object.assign(new Error('SAP credentials are missing. Set SAP_USERNAME and SAP_PASSWORD, or SAP_AUTH_HEADER.'), {
      statusCode: 500,
    })
  }

  const response = await fetch(`${SAP_BASE_URL}${path}`, {
    headers: { authorization: auth, accept: 'application/json' },
  })
  const body = await getResponseBody(response)
  if (!response.ok) {
    throw Object.assign(new Error(`SAP request failed for ${path}. ${stringifyDetail(body)}`), {
      statusCode: response.status,
      detail: body,
    })
  }
  return body
}

const sapGetText = async (path, options = {}) => {
  const auth = getAuthHeader(options)
  if (!auth) {
    throw Object.assign(new Error('SAP credentials are missing. Set SAP_USERNAME and SAP_PASSWORD, or SAP_AUTH_HEADER.'), {
      statusCode: 500,
    })
  }

  const response = await fetch(`${SAP_BASE_URL}${path}`, {
    headers: { authorization: auth, accept: 'application/xml,text/xml,*/*' },
  })
  const text = await response.text()
  if (!response.ok) {
    throw Object.assign(new Error(`SAP request failed for ${path}. ${text}`), {
      statusCode: response.status,
      detail: text,
    })
  }
  return text
}

const required = (value) => value !== undefined && value !== null && String(value).trim() !== ''

const parseQuantity = (value) => {
  const quantity = Number(value)
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw Object.assign(new Error('Goods issue quantity must be a whole number greater than zero.'), {
      statusCode: 400,
    })
  }
  return quantity
}

const extractSerialNumber = (value) => {
  if (typeof value === 'object' && value !== null) {
    return value.SerialNumber ?? value.serialNumber ?? value.AssetSerialNumber
  }

  return value
}

const splitSerialNumbers = (value) => {
  if (!required(value)) return []

  if (Array.isArray(value)) {
    return value
      .map(extractSerialNumber)
      .flatMap(splitSerialNumbers)
      .filter(Boolean)
  }

  if (typeof value === 'object') {
    return splitSerialNumbers(value.results)
  }

  return String(value)
    .split(/[\s,;]+/)
    .map((serialNumber) => serialNumber.trim())
    .filter(Boolean)
}

const validateSerialNumbers = (serialNumbers, quantity) => {
  if (serialNumbers.length !== quantity) {
    throw Object.assign(
      new Error(`Maintain serial numbers for total quantity. Quantity is ${quantity}, but ${serialNumbers.length} serial number(s) were provided.`),
      { statusCode: 400 },
    )
  }

  const duplicates = serialNumbers.filter((serialNumber, index) => serialNumbers.indexOf(serialNumber) !== index)
  if (duplicates.length > 0) {
    throw Object.assign(new Error(`Duplicate serial number(s): ${[...new Set(duplicates)].join(', ')}`), {
      statusCode: 400,
    })
  }
}

const getODataResults = (value) => value?.d?.results ?? value?.value ?? value?.results ?? []

const getODataEntity = (value) => value?.d ?? value?.value ?? value ?? {}

const parseSapDate = (value) => {
  if (!required(value)) return null
  const odataDate = String(value).match(/\/Date\((\d+)\)\//)
  if (odataDate) return new Date(Number(odataDate[1]))

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const toODataV2Date = (date) => `/Date(${Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())})/`

const toODataV2DateTime = (value) => {
  const date = parseSapDate(value) || new Date()
  return `/Date(${date.getTime()})/`
}

const toISODate = (value) => {
  const date = parseSapDate(value)
  return date ? date.toISOString().slice(0, 10) : null
}

const toFirstDayOfMonthISO = (value) => {
  const date = parseSapDate(value)
  if (!date) return null

  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${month}-01`
}

const escapeODataString = (value) => String(value).replaceAll("'", "''")

const startOfLocalDay = (date = new Date()) => new Date(date.getFullYear(), date.getMonth(), date.getDate())

const endOfLocalDay = (date = new Date()) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)

const isDateInRange = (value, startDate, endDate) => {
  const date = parseSapDate(value)
  return date ? date >= startDate && date <= endDate : false
}

const materialItemKey = (item) =>
  [
    item.MaterialDocument,
    item.MaterialDocumentYear,
    item.MaterialDocumentItem,
  ].map((value) => String(value || '').trim()).join('/')

const loadProcessedStore = async () => {
  try {
    return JSON.parse(await readFile(PROCESSED_STORE_PATH, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return { items: {} }
    throw error
  }
}

const saveProcessedStore = async (store) => {
  await mkdir(dirname(PROCESSED_STORE_PATH), { recursive: true })
  await writeFile(PROCESSED_STORE_PATH, JSON.stringify(store, null, 2))
}

const updateProcessedItem = async (key, patch) => {
  const store = await loadProcessedStore()
  store.items ||= {}
  store.items[key] = {
    ...(store.items[key] || {}),
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  await saveProcessedStore(store)
  return store.items[key]
}

const withoutEmptyValues = (payload) =>
  Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined && value !== null && value !== ''))

let cboPropertyNameCache = null

const normalizeName = (value) => String(value || '').replace(/^YY1/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase()

const extractMetadataProperties = (metadata) =>
  [...String(metadata || '').matchAll(/<Property\b[^>]*\bName="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((name) => !['SAP_UUID'].includes(name))

const getCboPropertyNames = async () => {
  if (cboPropertyNameCache) return cboPropertyNameCache

  try {
    const metadata = await sapGetText('/sap/opu/odata/sap/YY1_ASSETUPLOADAUTOMATION_CDS/$metadata')
    cboPropertyNameCache = extractMetadataProperties(metadata)
  } catch (error) {
    console.warn(`Could not read CBO metadata, using configured field names: ${error.message}`)
    cboPropertyNameCache = Object.values(CBO_FIELDS)
  }

  return cboPropertyNameCache
}

const findCboProperty = (properties, configuredName, aliases = []) => {
  const candidates = [configuredName, ...aliases].map(normalizeName)
  return properties.find((property) => candidates.includes(normalizeName(property)))
    || properties.find((property) => {
      const normalizedProperty = normalizeName(property)
      return candidates.some((candidate) => normalizedProperty.startsWith(candidate))
    })
}

const addCboField = (payload, properties, key, value, aliases = []) => {
  if (!required(value)) return
  const property = findCboProperty(properties, CBO_FIELDS[key], aliases)
  if (property) payload[property] = value
}

const buildCboPayload = async ({
  grnItem,
  status,
  errorMessage = '',
  assetNumbers = [],
  source = '',
  productGroup = '',
  assetClass = '',
  inventoryBalance,
  processedOn = new Date().toISOString(),
}) => {
  const properties = await getCboPropertyNames()
  const serialNumbers = Array.isArray(grnItem?.serialNumbers)
    ? grnItem.serialNumbers
    : splitSerialNumbers(grnItem?.serialNumbers || grnItem?.to_SerialNumbers)
  let resolvedProductGroup = productGroup || grnItem?.productGroup || ''
  let resolvedAssetClass = assetClass || grnItem?.assetClass || ''
  if (!resolvedProductGroup || !resolvedAssetClass) {
    try {
      const mapping = await getAssetClassMappingForGrnItem(grnItem)
      resolvedProductGroup ||= mapping.productGroup
      resolvedAssetClass ||= mapping.assetClass
    } catch {
      resolvedProductGroup ||= ''
      resolvedAssetClass ||= ''
    }
  }
  let poDescription = compactText(grnItem?.poDescription, 50)
  if (!poDescription) {
    try {
      poDescription = await getPurchaseOrderItemText(grnItem)
    } catch {
      poDescription = ''
    }
  }
  const payload = {}

  addCboField(payload, properties, 'materialDocument', String(grnItem?.grnNumber ?? grnItem?.MaterialDocument ?? ''), [
    'MaterialDocument',
    'MaterialDoc',
    'GRN',
    'GRNNumber',
    'GrnNumber',
  ])
  addCboField(payload, properties, 'materialDocumentItem', String(grnItem?.materialDocumentItem ?? grnItem?.MaterialDocumentItem ?? ''), [
    'MaterialDocumentItem',
    'MaterialDocItem',
    'GRNItem',
    'Item',
  ])
  addCboField(payload, properties, 'material', String(grnItem?.material ?? grnItem?.Material ?? ''), ['Material'])
  addCboField(payload, properties, 'productGroup', resolvedProductGroup, ['ProductGroup', 'MaterialGroup'])
  addCboField(payload, properties, 'assetClass', resolvedAssetClass, ['AssetClass'])
  addCboField(payload, properties, 'plant', String(grnItem?.plant ?? grnItem?.Plant ?? ''), ['Plant'])
  addCboField(payload, properties, 'storageLocation', String(grnItem?.storageLocation ?? grnItem?.StorageLocation ?? ''), ['StorageLocation', 'StorageLoc'])
  addCboField(payload, properties, 'quantity', String(Math.abs(Number(grnItem?.quantity ?? grnItem?.QuantityInEntryUnit ?? grnItem?.Quantity ?? 0)) || ''), ['Quantity'])
  addCboField(payload, properties, 'serialNumbers', serialNumbers.join(', '), ['SerialNumbers', 'SerialNumber'])
  addCboField(payload, properties, 'assetNumbers', assetNumbers.filter(required).join(', '), ['AssetNumbers', 'AssetNumber', 'FixedAsset'])
  addCboField(payload, properties, 'processedStatus', status, ['ProcessingStatus', 'ProcessedStatus', 'Status'])
  addCboField(payload, properties, 'errorMessage', compactText(errorMessage, 500), ['ErrorMessage', 'SAPErrorMessage', 'Message'])
  addCboField(payload, properties, 'processedOn', toODataV2DateTime(processedOn), ['ProcessedOn', 'ProcessedAt', 'AssetCreationTime'])
  addCboField(payload, properties, 'poDescription', poDescription, [
    'Description',
    'PurchaseOrderItemText',
    'PurchaseOrderDescription',
    'PODescription',
    'AssetDescription',
  ])
  addCboField(payload, properties, 'source', source, ['Source', 'ProcessSource'])

  if (inventoryBalance?.quantity !== undefined && inventoryBalance?.quantity !== null) {
    const balanceProperty = findCboProperty(properties, 'InventoryBalance', ['Balance', 'InventoryBalance'])
    if (balanceProperty) payload[balanceProperty] = `${inventoryBalance.quantity} ${inventoryBalance.unit || ''}`.trim()
  }

  return withoutEmptyValues(payload)
}

const writeCboProcessLog = async (record) => {
  try {
    const payload = await buildCboPayload(record)
    if (Object.keys(payload).length === 0) {
      return { written: false, error: 'No matching writable CBO fields were found.' }
    }

    await sapRequest(
      ENDPOINTS.assetUploadAutomation,
      'POST',
      payload,
      { tokenPath: ENDPOINTS.assetUploadAutomation },
    )
    return { written: true }
  } catch (error) {
    console.warn(`Could not write asset process log to CBO: ${error.message}`)
    return { written: false, error: error.message, detail: error.detail }
  }
}

const ensureStoredItemCboLog = async (key, sourceItem, storedItem, source = storedItem?.source || 'scheduler') => {
  if (!storedItem || storedItem.cboLog?.written) return storedItem?.cboLog

  const status = storedItem.status === 'success' || hasCreatedAssetsForQuantity(storedItem, storedItem.quantity || 0)
    ? 'Success'
    : storedItem.status === 'failed'
      ? 'Failed'
      : ''
  if (!status) return storedItem.cboLog

  const cboLog = await writeCboProcessLog({
    grnItem: {
      ...sourceItem,
      grnNumber: storedItem.materialDocument || sourceItem.MaterialDocument,
      materialDocumentItem: storedItem.materialDocumentItem || sourceItem.MaterialDocumentItem,
      material: storedItem.material || sourceItem.Material,
      quantity: storedItem.quantity || sourceItem.QuantityInEntryUnit,
      serialNumbers: storedItem.serialNumbers || splitSerialNumbers(sourceItem.to_SerialNumbers),
      poDescription: storedItem.poDescription,
    },
    status,
    errorMessage: storedItem.error || '',
    assetNumbers: getStoredAssetNumbers(storedItem),
    productGroup: storedItem.productGroup,
    assetClass: storedItem.assetClass,
    inventoryBalance: storedItem.inventoryBalance,
    source,
    processedOn: storedItem.updatedAt || new Date().toISOString(),
  })

  await updateProcessedItem(key, { cboLog })
  return cboLog
}

const mergeAssetTemplateForItem = (asset, grnItem, assetClass, preserveManualValues = false) => {
  const assetPayload = JSON.parse(JSON.stringify(asset || defaultAssetTemplate))
  if (preserveManualValues) assetPayload.AssetClass ||= assetClass
  else assetPayload.AssetClass = assetClass
  assetPayload._General ||= {}
  assetPayload._AccountAssignment ||= {}
  assetPayload._Inventory ||= {}
  assetPayload._Ledger ||= JSON.parse(JSON.stringify(defaultAssetTemplate._Ledger))
  assetPayload._Ledger[0] ||= JSON.parse(JSON.stringify(defaultAssetTemplate._Ledger[0]))
  assetPayload._Ledger[0]._Valuation ||= JSON.parse(JSON.stringify(defaultAssetTemplate._Ledger[0]._Valuation))
  assetPayload._Ledger[0]._Valuation[0] ||= JSON.parse(JSON.stringify(defaultAssetTemplate._Ledger[0]._Valuation[0]))
  assetPayload._Ledger[0]._Valuation[0]._TimeBasedValuation ||= JSON.parse(JSON.stringify(defaultAssetTemplate._Ledger[0]._Valuation[0]._TimeBasedValuation))
  assetPayload._Ledger[0]._Valuation[0]._TimeBasedValuation[0] ||= JSON.parse(JSON.stringify(defaultAssetTemplate._Ledger[0]._Valuation[0]._TimeBasedValuation[0]))

  const poDescription = compactText(grnItem.poDescription, 50)
  if (poDescription && !preserveManualValues) {
    assetPayload._General.FixedAssetDescription = poDescription
    assetPayload._General.AssetAdditionalDescription = poDescription
  } else {
    assetPayload._General.FixedAssetDescription ||= `${grnItem.material} ${grnItem.grnNumber}`
    assetPayload._General.AssetAdditionalDescription ||= `GRN ${grnItem.grnNumber} item ${grnItem.materialDocumentItem}`
  }
  assetPayload._AccountAssignment.Plant ||= grnItem.plant
  if (preserveManualValues) assetPayload._Ledger[0].AssetCapitalizationDate ||= grnItem.postingDateISO
  else assetPayload._Ledger[0].AssetCapitalizationDate = grnItem.postingDateISO

  const valuation = assetPayload._Ledger[0]._Valuation[0]
  const timeBasedValuation = valuation._TimeBasedValuation[0]
  const monthStartDate = toFirstDayOfMonthISO(grnItem.postingDateISO) || grnItem.postingDateISO
  valuation.DepreciationStartDate ||= monthStartDate
  timeBasedValuation.ValidityStartDate ||= valuation.DepreciationStartDate

  return assetPayload
}

const getGrnDetails = async (materialDocument) => {
  if (!required(materialDocument)) {
    throw Object.assign(new Error('GRN number is mandatory.'), { statusCode: 400 })
  }
  const query = new URLSearchParams({
    '$filter': `MaterialDocument eq '${escapeODataString(materialDocument)}' and GoodsMovementType eq '101'`,
    '$expand': 'to_MaterialDocumentHeader,to_SerialNumbers',
    '$orderby': 'MaterialDocumentYear desc,MaterialDocumentItem asc',
    '$format': 'json',
  })
  const body = await sapGet(`${ENDPOINTS.materialDocumentItems}?${query}`)
  const items = getODataResults(body)
  if (items.length === 0) {
    throw Object.assign(new Error(`No 101 goods receipt was found for GRN ${materialDocument}.`), {
      statusCode: 404,
      detail: body,
    })
  }

  return enrichGrnDetails(await buildGrnDetailsFromItems(materialDocument, items, body))
}

const buildGrnDetailsFromItems = (materialDocument, items, rawBody) => {
  const materialYears = [...new Set(items.map((item) => item.MaterialDocumentYear).filter(required))]
  if (materialYears.length > 1) {
    throw Object.assign(new Error(`GRN ${materialDocument} exists in multiple material document years; enter a unique GRN.`), {
      statusCode: 409,
    })
  }

  const materials = [...new Set(items.map((item) => item.Material).filter(required).map(String))]
  const plants = [...new Set(items.map((item) => item.Plant).filter(required).map(String))]
  const storageLocations = [...new Set(items.map((item) => item.StorageLocation).filter(required).map(String))]
  if (materials.length !== 1 || plants.length !== 1 || storageLocations.length !== 1) {
    const itemDetails = items.map(normalizeGrnItem)
    return {
      grnNumber: String(materialDocument),
      materialDocumentYear: materialYears[0] || '',
      multipleItems: true,
      items: itemDetails,
      postingDate: itemDetails[0]?.postingDate,
      documentDate: itemDetails[0]?.documentDate,
      postingDateISO: itemDetails[0]?.postingDateISO,
    }
  }

  const header = getODataResults(items[0]?.to_MaterialDocumentHeader)[0] ?? items[0]?.to_MaterialDocumentHeader ?? items[0]
  const postingDate = header?.PostingDate
  const documentDate = header?.DocumentDate
  if (!required(postingDate) || !required(documentDate)) {
    throw Object.assign(new Error(`Posting and document dates were not returned for GRN ${materialDocument}.`), {
      statusCode: 404,
      detail: rawBody,
    })
  }

  const serialNumbers = items.flatMap((item) => splitSerialNumbers(item.to_SerialNumbers))
  const quantityValue = items.reduce((total, item) => total + Math.abs(Number(item.QuantityInEntryUnit ?? item.Quantity ?? 0)), 0)
  const quantity = parseQuantity(quantityValue)
  validateSerialNumbers(serialNumbers, quantity)
  const firstProjectStock = getProjectStockFields(items[0])

  return {
    grnNumber: String(materialDocument),
    materialDocumentYear: materialYears[0] || '',
    material: materials[0],
    purchaseOrder: String(items[0].PurchaseOrder || ''),
    purchaseOrderItem: String(items[0].PurchaseOrderItem || ''),
    plant: plants[0],
    storageLocation: storageLocations[0],
    entryUnit: items[0].EntryUnit || 'EA',
    quantity,
    serialNumbers,
    postingDate,
    documentDate,
    postingDateISO: toISODate(postingDate),
    wbsElement: firstProjectStock.wbsElement,
    inventorySpecialStockType: firstProjectStock.inventorySpecialStockType,
    items: items.map(normalizeGrnItem),
  }
}

const getProjectStockFields = (item) => {
  const inventorySpecialStockType = String(item?.InventorySpecialStockType || '').trim()
  const wbsElement = inventorySpecialStockType
    ? String(item?.WBSElement || item?.SpecialStockIdfgWBSElement || '').trim()
    : ''

  return {
    inventorySpecialStockType,
    wbsElement,
  }
}

const normalizeGrnItem = (item) => {
  const header = getODataResults(item?.to_MaterialDocumentHeader)[0] ?? item?.to_MaterialDocumentHeader ?? item
  const postingDate = header?.PostingDate
  const documentDate = header?.DocumentDate
  const serialNumbers = splitSerialNumbers(item.to_SerialNumbers)
  const quantity = parseQuantity(Math.abs(Number(item.QuantityInEntryUnit ?? item.Quantity ?? 0)))
  const projectStock = getProjectStockFields(item)
  validateSerialNumbers(serialNumbers, quantity)

  return {
    key: materialItemKey(item),
    grnNumber: String(item.MaterialDocument),
    materialDocumentYear: String(item.MaterialDocumentYear || ''),
    materialDocumentItem: String(item.MaterialDocumentItem || ''),
    purchaseOrder: String(item.PurchaseOrder || ''),
    purchaseOrderItem: String(item.PurchaseOrderItem || ''),
    material: String(item.Material || ''),
    plant: String(item.Plant || ''),
    storageLocation: String(item.StorageLocation || ''),
    entryUnit: item.EntryUnit || 'EA',
    quantity,
    serialNumbers,
    postingDate,
    documentDate,
    postingDateISO: toISODate(postingDate),
    wbsElement: projectStock.wbsElement,
    inventorySpecialStockType: projectStock.inventorySpecialStockType,
    raw: item,
  }
}

const getProductGroup = async (material) => {
  const body = await sapGet(`${ENDPOINTS.product}('${escapeODataString(material)}')?$format=json`)
  const product = getODataEntity(body)
  const productGroup = product.ProductGroup
  if (!required(productGroup)) {
    throw Object.assign(new Error(`ProductGroup was not returned for material ${material}.`), {
      statusCode: 404,
      detail: body,
    })
  }
  return String(productGroup)
}

const getAssetClassForMaterial = async (material) => {
  const productGroup = await getProductGroup(material)
  const assetClass = PRODUCT_GROUP_ASSET_CLASS[productGroup]
  if (!assetClass) {
    throw Object.assign(new Error(`No asset class mapping is configured for ProductGroup ${productGroup} on material ${material}.`), {
      statusCode: 422,
      detail: { material, productGroup, supportedProductGroups: Object.keys(PRODUCT_GROUP_ASSET_CLASS) },
    })
  }
  return { productGroup, assetClass }
}

const getPurchaseOrderItemDetails = async (grnItem) => {
  const purchaseOrder = grnItem.purchaseOrder || grnItem.PurchaseOrder || grnItem.raw?.PurchaseOrder
  const purchaseOrderItem = grnItem.purchaseOrderItem || grnItem.PurchaseOrderItem || grnItem.raw?.PurchaseOrderItem
  if (!required(purchaseOrder) || !required(purchaseOrderItem)) return {}

  const query = new URLSearchParams({
    '$filter': [
      `PurchaseOrder eq '${escapeODataString(purchaseOrder)}'`,
      `PurchaseOrderItem eq '${escapeODataString(purchaseOrderItem)}'`,
    ].join(' and '),
    '$select': 'PurchaseOrder,PurchaseOrderItem,PurchaseOrderItemText,MaterialGroup',
    '$format': 'json',
  })
  const body = await sapGet(`${ENDPOINTS.purchaseOrderItems}?${query}`, {
    username: PO_USERNAME,
    password: PO_PASSWORD,
    authHeader: PO_AUTH_HEADER,
  })
  return getODataResults(body)[0] || getODataEntity(body)
}

const getPurchaseOrderItemText = async (grnItem) => {
  const item = await getPurchaseOrderItemDetails(grnItem)
  return compactText(item?.PurchaseOrderItemText, 50)
}

const getAssetClassMappingForGrnItem = async (grnItem) => {
  try {
    return await getAssetClassForMaterial(grnItem.material ?? grnItem.Material)
  } catch (error) {
    const poItem = await getPurchaseOrderItemDetails(grnItem)
    const productGroup = String(poItem?.MaterialGroup || error.detail?.productGroup || '').trim()
    const assetClass = PRODUCT_GROUP_ASSET_CLASS[productGroup]
    if (!productGroup || !assetClass) throw error
    return { productGroup, assetClass }
  }
}

const enrichAssetDescriptionFromPo = async (asset, grnItem) => {
  try {
    const purchaseOrderItemText = compactText(grnItem.poDescription, 50) || await getPurchaseOrderItemText(grnItem)
    if (!purchaseOrderItemText) return asset

    return {
      ...asset,
      _General: {
        ...asset._General,
        FixedAssetDescription: purchaseOrderItemText,
        AssetAdditionalDescription: purchaseOrderItemText,
      },
    }
  } catch (error) {
    console.warn(`Could not fetch PO item text for GRN ${grnItem.grnNumber}/${grnItem.materialDocumentItem}: ${error.message}`)
    return asset
  }
}

const enrichGrnItemDetails = async (grnItem) => {
  const enriched = { ...grnItem }

  try {
    const mapping = await getAssetClassMappingForGrnItem(grnItem)
    enriched.productGroup = mapping.productGroup
    enriched.assetClass = mapping.assetClass
  } catch (error) {
    enriched.productGroup = error.detail?.productGroup || ''
    enriched.assetClass = ''
    enriched.mappingError = error.message
  }

  try {
    enriched.poDescription = await getPurchaseOrderItemText(grnItem)
  } catch (error) {
    console.warn(`Could not fetch PO item text for GRN ${grnItem.grnNumber}/${grnItem.materialDocumentItem}: ${error.message}`)
    enriched.poDescription = ''
  }
  return enriched
}

const enrichGrnDetails = async (grn) => {
  const items = []
  for (const item of grn.items || []) {
    items.push(await enrichGrnItemDetails(item))
  }

  const firstItem = items[0] || await enrichGrnItemDetails(grn)
  const uniqueMaterials = [...new Set(items.map((item) => item.material).filter(required))]
  const serialNumbers = grn.serialNumbers?.length
    ? grn.serialNumbers
    : items.flatMap((item) => item.serialNumbers || [])
  const quantity = grn.quantity ?? items.reduce((total, item) => total + Number(item.quantity || 0), 0)
  return {
    ...grn,
    items: items.length ? items : grn.items,
    material: grn.material || uniqueMaterials.join(', '),
    plant: grn.plant || firstItem.plant || '',
    storageLocation: grn.storageLocation || firstItem.storageLocation || '',
    entryUnit: grn.entryUnit || firstItem.entryUnit || 'EA',
    quantity,
    serialNumbers,
    productGroup: firstItem.productGroup || '',
    assetClass: firstItem.assetClass || '',
    mappingError: firstItem.mappingError || '',
    poDescription: firstItem.poDescription || '',
    purchaseOrder: firstItem.purchaseOrder || grn.purchaseOrder || '',
    purchaseOrderItem: firstItem.purchaseOrderItem || grn.purchaseOrderItem || '',
    wbsElement: grn.wbsElement || firstItem.wbsElement || '',
    inventorySpecialStockType: grn.inventorySpecialStockType || firstItem.inventorySpecialStockType || '',
  }
}

const getStockQuantity = (item) => {
  const candidates = [
    item.MatlWrhsStkQtyInMatlBaseUnit,
    item.MaterialStockQuantity,
    item.UnrestrictedUseStock,
    item.UnrestrictedStockQuantity,
    item.StockQty,
    item.Quantity,
  ]
  const quantity = candidates.map(Number).find((value) => Number.isFinite(value))
  return quantity || 0
}

const getInventoryBalance = async ({ material, plant, storageLocation }) => {
  const query = new URLSearchParams({
    '$filter': [
      `Material eq '${escapeODataString(material)}'`,
      `Plant eq '${escapeODataString(plant)}'`,
      `StorageLocation eq '${escapeODataString(storageLocation)}'`,
    ].join(' and '),
    '$format': 'json',
  })
  const body = await sapGet(`${ENDPOINTS.materialStock}?${query}`)
  const rows = getODataResults(body)
  const quantity = rows.reduce((total, row) => total + getStockQuantity(row), 0)
  const unit = rows.find((row) => required(row.MaterialBaseUnit))?.MaterialBaseUnit || 'EA'
  return { quantity, unit, rows }
}

const getInventoryBalanceSafe = async (item) => {
  try {
    return await getInventoryBalance({
      material: String(item.Material ?? item.material ?? ''),
      plant: String(item.Plant ?? item.plant ?? ''),
      storageLocation: String(item.StorageLocation ?? item.storageLocation ?? ''),
    })
  } catch (error) {
    return { quantity: null, unit: '', unavailable: true }
  }
}

const extractAssetNumber = (payload) => {
  const candidates = [
    payload?.MasterFixedAsset,
    payload?.FixedAsset,
    payload?.d?.MasterFixedAsset,
    payload?.d?.FixedAsset,
    payload?.value?.MasterFixedAsset,
    payload?.value?.FixedAsset,
  ]
  const assetNumber = candidates.find(required)

  if (!assetNumber) {
    throw Object.assign(new Error('Asset was created, but SAP did not return MasterFixedAsset or FixedAsset.'), {
      statusCode: 502,
      detail: payload,
    })
  }

  return String(assetNumber)
}

const getPathValue = (source, path) =>
  path
    .replaceAll('[0]', '.0')
    .split('.')
    .reduce((current, key) => current?.[key], source)

const validatePayload = ({ goodsIssue, asset }) => {
  const missingGoodsIssue = [
    'GoodsMovementCode',
    'PostingDate',
    'DocumentDate',
    'Material',
    'Plant',
    'StorageLocation',
    'GoodsMovementType',
    'EntryUnit',
    'QuantityInEntryUnit',
  ].filter((field) => !required(goodsIssue?.[field]))

  const missingAsset = [
    'CompanyCode',
    'AssetClass',
    '_General.FixedAssetDescription',
    '_AccountAssignment.CostCenter',
    '_AccountAssignment.Plant',
    '_Ledger[0].AssetCapitalizationDate',
    '_Ledger[0]._Valuation[0].DepreciationStartDate',
    '_Ledger[0]._Valuation[0]._TimeBasedValuation[0].ValidityStartDate',
  ].filter((field) => !required(getPathValue(asset, field)))

  const missing = [...missingGoodsIssue, ...missingAsset]
  if (missing.length > 0) {
    throw Object.assign(new Error(`Missing mandatory fields: ${missing.join(', ')}`), {
      statusCode: 400,
    })
  }
}

const buildAssetPayload = (asset, serialNumber, capitalizationDate) => {
  const assetPayload = JSON.parse(JSON.stringify(asset))
  assetPayload._General = {
    ...assetPayload._General,
    AssetSerialNumber: serialNumber,
    BaseUnitSAPCode: assetPayload._General?.BaseUnitSAPCode || 'EA',
    BaseUnitISOCode: assetPayload._General?.BaseUnitISOCode || assetPayload._General?.BaseUnitSAPCode || 'EA',
  }
  assetPayload._Ledger[0].AssetCapitalizationDate ||= capitalizationDate

  return assetPayload
}

const buildGoodsIssuePayload = (goodsIssue, assetNumbers, serialNumbers) => {
  const postingDate = parseSapDate(goodsIssue.PostingDate)
  const documentDate = parseSapDate(goodsIssue.DocumentDate)
  return {
    GoodsMovementCode: goodsIssue.GoodsMovementCode,
    MaterialDocumentHeaderText: goodsIssue.MaterialDocumentHeaderText || undefined,
    PostingDate: postingDate ? toODataV2Date(postingDate) : goodsIssue.PostingDate,
    DocumentDate: documentDate ? toODataV2Date(documentDate) : goodsIssue.DocumentDate,
    to_MaterialDocumentItem: {
      results: assetNumbers.map((assetNumber, index) => ({
        Material: goodsIssue.Material,
        Plant: goodsIssue.Plant,
        StorageLocation: goodsIssue.StorageLocation,
        GoodsMovementType: goodsIssue.GoodsMovementType || '241',
        EntryUnit: goodsIssue.EntryUnit || 'EA',
        QuantityInEntryUnit: '1',
        MasterFixedAsset: assetNumber,
        to_SerialNumbers: {
          results: [
            {
              SerialNumber: serialNumbers[index],
            },
          ],
        },
      })),
    },
  }
}

const processGrnItem = async (grnItem, options = {}) => {
  const { asset: requestedAsset, resumeAssetNumbers = [], persistProgress = false, preserveManualAsset = false } = options
  const { productGroup, assetClass } = preserveManualAsset && required(requestedAsset?.AssetClass)
    ? { productGroup: grnItem.productGroup || '', assetClass: String(requestedAsset.AssetClass) }
    : await getAssetClassMappingForGrnItem(grnItem)

  if (!grnItem.postingDateISO) {
    throw Object.assign(new Error(`A valid GRN posting date is required for asset capitalization on ${grnItem.key}.`), {
      statusCode: 400,
    })
  }

  const mergedAsset = mergeAssetTemplateForItem(requestedAsset, grnItem, assetClass, preserveManualAsset)
  const asset = preserveManualAsset
    ? mergedAsset
    : await enrichAssetDescriptionFromPo(mergedAsset, grnItem)
  validatePayload({
    goodsIssue: {
      GoodsMovementCode: grnItem.goodsMovementCode || '03',
      PostingDate: grnItem.postingDate,
      DocumentDate: grnItem.documentDate,
      Material: grnItem.material,
      Plant: grnItem.plant,
      StorageLocation: grnItem.storageLocation,
      GoodsMovementType: grnItem.goodsMovementType || '241',
      EntryUnit: grnItem.entryUnit,
      QuantityInEntryUnit: String(grnItem.quantity),
    },
    asset,
  })

  if (resumeAssetNumbers.length > grnItem.quantity) {
    throw Object.assign(new Error(`Recovery asset count is greater than the GRN item quantity for ${grnItem.key}.`), {
      statusCode: 400,
    })
  }

  const createdAssets = resumeAssetNumbers.map((masterFixedAsset, index) => ({
    index: index + 1,
    serialNumber: grnItem.serialNumbers[index],
    masterFixedAsset,
    resumed: true,
  }))

  for (let index = resumeAssetNumbers.length; index < grnItem.quantity; index += 1) {
    const assetPayload = buildAssetPayload(asset, grnItem.serialNumbers[index], grnItem.postingDateISO)
    const assetResponse = await sapRequest(
      ENDPOINTS.fixedAssetCreate,
      'POST',
      assetPayload,
      {
        tokenPath: ENDPOINTS.fixedAssetCollection,
      },
    )

    const masterFixedAsset = extractAssetNumber(assetResponse)

    createdAssets.push({
      index: index + 1,
      serialNumber: grnItem.serialNumbers[index],
      masterFixedAsset,
      assetPayload,
      assetResponse,
    })

    if (persistProgress) {
      await updateProcessedItem(grnItem.key, {
        status: 'assets-created',
        assetNumbers: createdAssets.map((item) => item.masterFixedAsset),
        serialNumbers: grnItem.serialNumbers,
        poDescription: grnItem.poDescription,
        productGroup,
        assetClass,
        material: grnItem.material,
        materialDocument: grnItem.grnNumber,
        materialDocumentYear: grnItem.materialDocumentYear,
        materialDocumentItem: grnItem.materialDocumentItem,
      })
    }
  }

  const assetNumbers = createdAssets.map((item) => item.masterFixedAsset)
  const goodsIssuePayload = buildGoodsIssuePayload(
    {
      GoodsMovementCode: grnItem.goodsMovementCode || '03',
      MaterialDocumentHeaderText: grnItem.materialDocumentHeaderText || '',
      PostingDate: grnItem.postingDate,
      DocumentDate: grnItem.documentDate,
      Material: grnItem.material,
      Plant: grnItem.plant,
      StorageLocation: grnItem.storageLocation,
      GoodsMovementType: grnItem.goodsMovementType || '241',
      EntryUnit: grnItem.entryUnit || 'EA',
    },
    assetNumbers,
    grnItem.serialNumbers,
  )
  let goodsIssueResponse
  try {
    goodsIssueResponse = await sapRequest(ENDPOINTS.goodsIssue, 'POST', goodsIssuePayload)
  } catch (error) {
    error.partialResult = { assetNumbers, serialNumbers: grnItem.serialNumbers }
    const stockDeficit = getStockDeficitMessage(error.detail)
    if (stockDeficit) {
      error.message = `241 goods issue cannot be posted because unrestricted-use stock is insufficient. ${stockDeficit}. Existing asset numbers were saved and will be reused on retry.`
    }
    throw error
  }

  return {
    grn: grnItem,
    productGroup,
    assetClass,
    assetNumbers,
    serialNumbers: grnItem.serialNumbers,
    createdAssets,
    goodsIssuePayload,
    goodsIssueResponse,
  }
}

const applyManualGoodsIssueValues = (grnItem, goodsIssue, includeItemValues) => {
  const postingDate = required(goodsIssue?.PostingDate) ? goodsIssue.PostingDate : grnItem.postingDate
  const documentDate = required(goodsIssue?.DocumentDate) ? goodsIssue.DocumentDate : grnItem.documentDate
  const manualItem = {
    ...grnItem,
    goodsMovementCode: required(goodsIssue?.GoodsMovementCode) ? goodsIssue.GoodsMovementCode : '03',
    goodsMovementType: required(goodsIssue?.GoodsMovementType) ? goodsIssue.GoodsMovementType : '241',
    materialDocumentHeaderText: goodsIssue?.MaterialDocumentHeaderText || '',
    postingDate,
    documentDate,
    postingDateISO: toISODate(postingDate) || grnItem.postingDateISO,
    plant: required(goodsIssue?.Plant) ? goodsIssue.Plant : grnItem.plant,
    storageLocation: required(goodsIssue?.StorageLocation) ? goodsIssue.StorageLocation : grnItem.storageLocation,
    entryUnit: required(goodsIssue?.EntryUnit) ? goodsIssue.EntryUnit : grnItem.entryUnit,
  }

  if (includeItemValues) {
    manualItem.material = required(goodsIssue?.Material) ? goodsIssue.Material : grnItem.material
    manualItem.quantity = required(goodsIssue?.QuantityInEntryUnit)
      ? parseQuantity(goodsIssue.QuantityInEntryUnit)
      : grnItem.quantity
    manualItem.serialNumbers = required(goodsIssue?.SerialNumbers)
      ? splitSerialNumbers(goodsIssue.SerialNumbers)
      : grnItem.serialNumbers
    manualItem.productGroup = goodsIssue?.ProductGroup || grnItem.productGroup || ''
    manualItem.poDescription = goodsIssue?.PurchaseOrderDescription || grnItem.poDescription || ''
    validateSerialNumbers(manualItem.serialNumbers, manualItem.quantity)
  }

  return manualItem
}

const orchestrate = async (request) => {
  const payload = await readJson(request)
  const { goodsIssue: requestedGoodsIssue, asset } = payload
  const grn = await getGrnDetails(requestedGoodsIssue?.GrnNumber)
  const grnItems = grn.items?.length ? grn.items : [grn]
  const resumeAssetNumbers = Array.isArray(payload.resumeAssetNumbers)
    ? payload.resumeAssetNumbers.map(String).filter(required)
    : []
  if (resumeAssetNumbers.length > 0 && grnItems.length > 1) {
    throw Object.assign(new Error('Recovery asset numbers are supported only for single-item manual GRNs.'), {
      statusCode: 400,
    })
  }

  const results = []
  for (const [index, grnItem] of grnItems.entries()) {
    const manualGrnItem = applyManualGoodsIssueValues(grnItem, requestedGoodsIssue, grnItems.length === 1)
    try {
      const result = await processGrnItem(manualGrnItem, {
        asset,
        resumeAssetNumbers: index === 0 ? resumeAssetNumbers : [],
        preserveManualAsset: true,
      })
      await writeCboProcessLog({
        grnItem: manualGrnItem,
        status: 'Success',
        assetNumbers: result.assetNumbers,
        productGroup: result.productGroup,
        assetClass: result.assetClass,
        source: 'manual',
      })
      results.push(result)
    } catch (error) {
      await writeCboProcessLog({
        grnItem: manualGrnItem,
        status: 'Failed',
        errorMessage: error.message,
        assetNumbers: error.partialResult?.assetNumbers || [],
        source: 'manual',
      })
      throw error
    }
  }

  const response = {
    grn,
    items: results,
    assetNumbers: results.flatMap((item) => item.assetNumbers),
    serialNumbers: results.flatMap((item) => item.serialNumbers),
  }

  if (results.length === 1) {
    return {
      ...response,
      createdAssets: results[0].createdAssets,
      goodsIssuePayload: results[0].goodsIssuePayload,
      goodsIssueResponse: results[0].goodsIssueResponse,
      productGroup: results[0].productGroup,
      assetClass: results[0].assetClass,
    }
  }

  return response
}

/* AUTOMATION DISABLED: Uncomment this block to restore automatic/bulk GRN processing.
const fetchNewGoodsReceiptItems = async () => {
  const query = new URLSearchParams({
    '$filter': "GoodsMovementType eq '101'",
    '$expand': 'to_MaterialDocumentHeader,to_SerialNumbers',
    '$orderby': 'MaterialDocumentYear desc,MaterialDocument desc,MaterialDocumentItem asc',
    '$top': String(GRN_FETCH_TOP),
    '$format': 'json',
  })
  const body = await sapGet(`${ENDPOINTS.materialDocumentItems}?${query}`)
  return getODataResults(body)
}

const getItemPostingDate = (item) => {
  const header = getODataResults(item?.to_MaterialDocumentHeader)[0] ?? item?.to_MaterialDocumentHeader ?? item
  return header?.PostingDate
}

const fetchTodayGoodsReceiptItems = async () => {
  const startDate = startOfLocalDay()
  const endDate = endOfLocalDay()
  const items = await fetchNewGoodsReceiptItems()
  return items.filter((item) => isDateInRange(getItemPostingDate(item), startDate, endDate))
}

const getStoredAssetNumbers = (item) => item?.partialResult?.assetNumbers || item?.assetNumbers || []

const hasCreatedAssetsForQuantity = (item, quantity) => getStoredAssetNumbers(item).filter(required).length >= quantity

const processedStoreHasItem = (store, key, quantity = 0) => {
  const item = store.items?.[key]
  return item?.status === 'success' || hasCreatedAssetsForQuantity(item, quantity)
}

const processedStoreItemStatus = (store, key, quantity = 0) => {
  const item = store.items?.[key]
  if (!item) return 'Pending'
  if (item.status === 'success' || item.status === 'assets-created' || hasCreatedAssetsForQuantity(item, quantity)) return 'Asset Already Created'
  if (item.status === 'failed') return 'Failed'
  return item.status || 'Asset Already Created'
}

const buildGrnMonitorRow = async (item, store) => {
  const key = materialItemKey(item)
  const processedItem = store.items?.[key] || null
  const quantity = Math.abs(Number(item.QuantityInEntryUnit ?? item.Quantity ?? 0))
  const serialNumbers = splitSerialNumbers(item.to_SerialNumbers)
  const assetNumbers = getStoredAssetNumbers(processedItem)
  const inventoryBalance = processedItem?.inventoryBalance || await getInventoryBalanceSafe(item)
  let productGroup = ''
  let assetClass = ''
  let productError = ''

  try {
    const mapping = await getAssetClassForMaterial(item.Material)
    productGroup = mapping.productGroup
    assetClass = mapping.assetClass
  } catch (error) {
    productError = error.message
  }

  return {
    key,
    grnNumber: String(item.MaterialDocument || ''),
    materialDocumentYear: String(item.MaterialDocumentYear || ''),
    materialDocumentItem: String(item.MaterialDocumentItem || ''),
    material: String(item.Material || ''),
    productGroup,
    assetClass,
    quantity,
    serialNumbers,
    assetNumbers,
    serialAssetPairs: serialNumbers.map((serialNumber, index) => ({
      serialNumber,
      assetNumber: assetNumbers[index] || '',
    })),
    inventoryBalance,
    plant: String(item.Plant || ''),
    storageLocation: String(item.StorageLocation || ''),
    postingDate: getItemPostingDate(item),
    status: productError ? 'Failed' : processedStoreItemStatus(store, key, quantity),
    error: productError || (hasCreatedAssetsForQuantity(processedItem, quantity) ? '' : processedItem?.error || ''),
    processed: processedItem,
  }
}

const getTodayGrnMonitor = async () => {
  const store = await loadProcessedStore()
  const items = await fetchTodayGoodsReceiptItems()
  const rows = []
  for (const item of items) {
    rows.push(await buildGrnMonitorRow(item, store))
  }

  const startDate = startOfLocalDay()
  const autoProcessed = Object.values(store.items || {})
    .filter((item) => item.source === 'scheduler' && item.status === 'success')
    .filter((item) => isDateInRange(item.updatedAt, startDate, endOfLocalDay()))
    .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))

  return {
    date: startDate.toISOString().slice(0, 10),
    items: rows,
    automaticallyProcessed: autoProcessed,
  }
}

const recordSchedulerFailure = async (item, error, source = 'scheduler') => {
  const key = materialItemKey(item)
  const existingItem = (await loadProcessedStore()).items?.[key] || {}
  const assetNumbers = error.partialResult?.assetNumbers || existingItem.partialResult?.assetNumbers || existingItem.assetNumbers || []
  const serialNumbers = error.partialResult?.serialNumbers || existingItem.partialResult?.serialNumbers || existingItem.serialNumbers || []
  let mapping = { productGroup: existingItem.productGroup || '', assetClass: existingItem.assetClass || '' }
  try {
    mapping = await getAssetClassMappingForGrnItem(item)
  } catch {
    mapping = { productGroup: error.detail?.productGroup || mapping.productGroup, assetClass: mapping.assetClass }
  }
  let poDescription = existingItem.poDescription || ''
  if (!poDescription) {
    try {
      poDescription = await getPurchaseOrderItemText(item)
    } catch {
      poDescription = ''
    }
  }
  const failureRecord = {
    ...existingItem,
    status: 'failed',
    source,
    materialDocument: String(item.MaterialDocument || ''),
    materialDocumentYear: String(item.MaterialDocumentYear || ''),
    materialDocumentItem: String(item.MaterialDocumentItem || ''),
    material: String(item.Material || ''),
    error: error.message,
    detail: error.detail,
    failedPayload: error.failedPayload,
    partialResult: error.partialResult || existingItem.partialResult,
    assetNumbers,
    serialNumbers,
    inventoryBalance: await getInventoryBalanceSafe(item),
    productGroup: mapping.productGroup,
    assetClass: mapping.assetClass,
    poDescription,
  }

  console.error(
    [
      `Failed to auto-process GRN item ${failureRecord.materialDocument}/${failureRecord.materialDocumentItem}`,
      `Material ${failureRecord.material}`,
      error.message,
    ].join(' - '),
  )

  await writeCboProcessLog({
    grnItem: item,
    status: 'Failed',
    errorMessage: error.message,
    assetNumbers,
    productGroup: mapping.productGroup,
    assetClass: mapping.assetClass,
    inventoryBalance: failureRecord.inventoryBalance,
    source,
  })
  await updateProcessedItem(key, failureRecord)
}

const processDiscoveredGoodsReceiptItem = async (item, options = {}) => {
  const { source = 'scheduler', resumeAssetNumbers = [] } = options
  const discoveredKey = materialItemKey(item)
  const grn = await getGrnDetails(item.MaterialDocument)
  const grnItems = grn.items?.length ? grn.items : [grn]
  const grnItem = grnItems.find((candidate) => candidate.key === discoveredKey)
  if (!grnItem) {
    throw Object.assign(new Error(`Material document item ${discoveredKey} was not returned by GRN details.`), {
      statusCode: 404,
      detail: grn,
    })
  }

  const result = await processGrnItem(grnItem, { persistProgress: true, resumeAssetNumbers })
  const inventoryBalance = await getInventoryBalanceSafe(grnItem)
  const cboLog = await writeCboProcessLog({
    grnItem,
    status: 'Success',
    assetNumbers: result.assetNumbers,
    productGroup: result.productGroup,
    assetClass: result.assetClass,
    inventoryBalance,
    source,
  })
  await updateProcessedItem(grnItem.key, {
    status: 'success',
    source,
    materialDocument: grnItem.grnNumber,
    materialDocumentYear: grnItem.materialDocumentYear,
    materialDocumentItem: grnItem.materialDocumentItem,
    material: grnItem.material,
    plant: grnItem.plant,
    storageLocation: grnItem.storageLocation,
    quantity: grnItem.quantity,
    serialNumbers: grnItem.serialNumbers,
    assetNumbers: result.assetNumbers,
    inventoryBalance,
    productGroup: result.productGroup,
    assetClass: result.assetClass,
    poDescription: grnItem.poDescription,
    error: undefined,
    detail: undefined,
    failedPayload: undefined,
    partialResult: undefined,
    goodsIssueResponse: result.goodsIssueResponse,
    cboLog,
  })
  return result
}

const processPendingTodayGrns = async (source = 'manual-bulk') => {
  const store = await loadProcessedStore()
  const items = await fetchTodayGoodsReceiptItems()
  const success = []
  const failure = []
  const skipped = []

  for (const item of items) {
    const key = materialItemKey(item)
    const quantity = Math.abs(Number(item.QuantityInEntryUnit ?? item.Quantity ?? 0))
    const existingItem = store.items?.[key]
    if (processedStoreHasItem(store, key, quantity)) {
      await ensureStoredItemCboLog(key, item, existingItem, existingItem?.source || source)
      const assetNumbers = getStoredAssetNumbers(existingItem)
      const serialNumbers = existingItem?.serialNumbers || splitSerialNumbers(item.to_SerialNumbers)
      skipped.push({
        key,
        grnNumber: String(item.MaterialDocument || ''),
        materialDocumentItem: String(item.MaterialDocumentItem || ''),
        material: String(item.Material || ''),
        status: processedStoreItemStatus(store, key, quantity),
        serialNumbers,
        assetNumbers,
        serialAssetPairs: serialNumbers.map((serialNumber, index) => ({
          serialNumber,
          assetNumber: assetNumbers[index] || '',
        })),
      })
      continue
    }

    try {
      const resumeAssetNumbers = existingItem?.partialResult?.assetNumbers || existingItem?.assetNumbers || []
      const result = await processDiscoveredGoodsReceiptItem(item, { source, resumeAssetNumbers })
      store.items ||= {}
      store.items[key] = { status: 'success', source }
      success.push({
        key,
        grnNumber: result.grn.grnNumber,
        materialDocumentItem: result.grn.materialDocumentItem,
        material: result.grn.material,
        serialNumbers: result.serialNumbers,
        assetNumbers: result.assetNumbers,
        serialAssetPairs: result.serialNumbers.map((serialNumber, index) => ({
          serialNumber,
          assetNumber: result.assetNumbers[index] || '',
        })),
        inventoryBalance: await getInventoryBalanceSafe(result.grn),
        goodsIssueResponse: result.goodsIssueResponse,
      })
    } catch (error) {
      await recordSchedulerFailure(item, error, source)
      const savedItem = (await loadProcessedStore()).items?.[key] || {}
      store.items ||= {}
      store.items[key] = { status: 'failed', source }
      failure.push({
        key,
        grnNumber: String(item.MaterialDocument || ''),
        materialDocumentItem: String(item.MaterialDocumentItem || ''),
        material: String(item.Material || ''),
        error: error.message,
        serialNumbers: savedItem.serialNumbers || error.partialResult?.serialNumbers || [],
        assetNumbers: savedItem.assetNumbers || error.partialResult?.assetNumbers || [],
        serialAssetPairs: (savedItem.serialNumbers || error.partialResult?.serialNumbers || []).map((serialNumber, index) => ({
          serialNumber,
          assetNumber: (savedItem.assetNumbers || error.partialResult?.assetNumbers || [])[index] || '',
        })),
        inventoryBalance: savedItem.inventoryBalance || await getInventoryBalanceSafe(item),
      })
    }
  }

  return { success, failure, skipped, monitor: await getTodayGrnMonitor() }
}

let schedulerRunning = false

const runGoodsReceiptScheduler = async () => {
  if (schedulerRunning) {
    console.log('GRN scheduler skipped because the previous run is still active.')
    return
  }

  schedulerRunning = true
  try {
    const store = await loadProcessedStore()
    const items = await fetchTodayGoodsReceiptItems()
    let processedCount = 0
    let skippedCount = 0

    for (const item of items) {
      const key = materialItemKey(item)
      const quantity = Math.abs(Number(item.QuantityInEntryUnit ?? item.Quantity ?? 0))
      if (processedStoreHasItem(store, key, quantity)) {
        await ensureStoredItemCboLog(key, item, store.items?.[key], store.items?.[key]?.source || 'scheduler')
        skippedCount += 1
        continue
      }

      try {
        const existingItem = store.items?.[key]
        const resumeAssetNumbers = existingItem?.partialResult?.assetNumbers || existingItem?.assetNumbers || []
        await processDiscoveredGoodsReceiptItem(item, { source: 'scheduler', resumeAssetNumbers })
        store.items ||= {}
        store.items[key] = { status: 'success', source: 'scheduler' }
        processedCount += 1
      } catch (error) {
        await recordSchedulerFailure(item, error, 'scheduler')
        store.items ||= {}
        store.items[key] = { status: 'failed', source: 'scheduler' }
      }
    }

    console.log(`GRN scheduler complete. Processed ${processedCount}, skipped ${skippedCount}.`)
  } catch (error) {
    console.error(`GRN scheduler failed: ${error.message}`)
  } finally {
    schedulerRunning = false
  }
}

const startGoodsReceiptScheduler = () => {
  if (!SCHEDULER_ENABLED) {
    console.log('GRN scheduler is disabled.')
    return
  }

  console.log(`GRN scheduler enabled. Interval: ${SCHEDULER_INTERVAL_MS} ms.`)
  setTimeout(() => {
    runGoodsReceiptScheduler()
  }, 0)
  setInterval(runGoodsReceiptScheduler, SCHEDULER_INTERVAL_MS)
}
*/

const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname

  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {})
    return
  }

  if (request.method === 'POST' && pathname === '/api/create-goods-issue-with-assets') {
    try {
      sendJson(response, 200, await orchestrate(request))
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        error: error.message,
        detail: error.detail,
        failedPayload: error.failedPayload,
        partialResult: error.partialResult,
      })
    }
    return
  }

  if (request.method === 'POST' && pathname === '/api/grn-details') {
    try {
      const { grnNumber } = await readJson(request)
      sendJson(response, 200, await getGrnDetails(grnNumber))
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        error: error.message,
        detail: error.detail,
      })
    }
    return
  }

  /* AUTOMATION DISABLED: Uncomment these routes with the automation block above.
  if (request.method === 'POST' && pathname === '/api/today-grns') {
    try {
      sendJson(response, 200, await getTodayGrnMonitor())
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        error: error.message,
        detail: error.detail,
      })
    }
    return
  }

  if (request.method === 'POST' && pathname === '/api/process-pending-grns') {
    try {
      sendJson(response, 200, await processPendingTodayGrns('manual-bulk'))
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        error: error.message,
        detail: error.detail,
        failedPayload: error.failedPayload,
        partialResult: error.partialResult,
      })
    }
    return
  }
  */

  const frontendPath = join(__dirname, '..', 'client', 'dist', 'index.html')

if (existsSync(frontendPath)) {
  response.writeHead(200, {
    'content-type': 'text/html',
  })

  createReadStream(frontendPath).pipe(response)
  return
}

sendJson(response, 404, {
  error: `API route not found: ${request.method} ${pathname}`,
})
})

server.listen(PORT, () => {
  console.log(`Asset creation API running on http://localhost:${PORT}`)
  // AUTOMATION DISABLED: Uncomment after restoring the automation block above.
  // startGoodsReceiptScheduler()
})
