import http from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envLocalPath = join(__dirname, '..', '.env.local')

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

const ENDPOINTS = {
  goodsIssue:
    '/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader',
  materialDocumentItems:
    '/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentItem',
  fixedAssetCollection:
    '/sap/opu/odata4/sap/api_fixedasset/srvd_a2x/sap/fixedasset/0001/FixedAsset',
  fixedAssetCreate:
    '/sap/opu/odata4/sap/api_fixedasset/srvd_a2x/sap/fixedasset/0001/FixedAsset/SAP__self.CreateMasterFixedAsset',
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

const getAuthHeader = () => {
  if (SAP_AUTH_HEADER) return SAP_AUTH_HEADER
  if (!SAP_USERNAME || !SAP_PASSWORD) return null
  return `Basic ${Buffer.from(`${SAP_USERNAME}:${SAP_PASSWORD}`).toString('base64')}`
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
  const auth = getAuthHeader()
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

const sapGet = async (path) => {
  const auth = getAuthHeader()
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

const parseSapDate = (value) => {
  if (!required(value)) return null
  const odataDate = String(value).match(/\/Date\((\d+)\)\//)
  if (odataDate) return new Date(Number(odataDate[1]))

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const toODataV2Date = (date) => `/Date(${Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())})/`

const toISODate = (value) => {
  const date = parseSapDate(value)
  return date ? date.toISOString().slice(0, 10) : null
}

const escapeODataString = (value) => String(value).replaceAll("'", "''")

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
    throw Object.assign(
      new Error(`GRN ${materialDocument} must contain one material, plant, and storage location for this asset flow.`),
      { statusCode: 409, detail: { materials, plants, storageLocations } },
    )
  }

  const header = getODataResults(items[0]?.to_MaterialDocumentHeader)[0] ?? items[0]?.to_MaterialDocumentHeader ?? items[0]
  const postingDate = header?.PostingDate
  const documentDate = header?.DocumentDate
  if (!required(postingDate) || !required(documentDate)) {
    throw Object.assign(new Error(`Posting and document dates were not returned for GRN ${materialDocument}.`), {
      statusCode: 404,
      detail: body,
    })
  }

  const serialNumbers = items.flatMap((item) => splitSerialNumbers(item.to_SerialNumbers))
  const quantityValue = items.reduce((total, item) => total + Math.abs(Number(item.QuantityInEntryUnit ?? item.Quantity ?? 0)), 0)
  const quantity = parseQuantity(quantityValue)
  validateSerialNumbers(serialNumbers, quantity)

  return {
    grnNumber: String(materialDocument),
    materialDocumentYear: materialYears[0] || '',
    material: materials[0],
    plant: plants[0],
    storageLocation: storageLocations[0],
    entryUnit: items[0].EntryUnit || 'EA',
    quantity,
    serialNumbers,
    postingDate,
    documentDate,
    postingDateISO: toISODate(postingDate),
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
    BaseUnitSAPCode: 'EA',
    BaseUnitISOCode: 'EA',
  }
  assetPayload._Ledger[0].AssetCapitalizationDate = capitalizationDate

  return assetPayload
}

const buildGoodsIssuePayload = (goodsIssue, assetNumbers, serialNumbers) => {
  const postingDate = parseSapDate(goodsIssue.PostingDate)
  const documentDate = parseSapDate(goodsIssue.DocumentDate)
  return {
    GoodsMovementCode: goodsIssue.GoodsMovementCode,
    PostingDate: postingDate ? toODataV2Date(postingDate) : goodsIssue.PostingDate,
    DocumentDate: documentDate ? toODataV2Date(documentDate) : goodsIssue.DocumentDate,
    MaterialDocumentHeaderText: goodsIssue.MaterialDocumentHeaderText,
    to_MaterialDocumentItem: {
      results: assetNumbers.map((assetNumber, index) => ({
        Material: goodsIssue.Material,
        Plant: goodsIssue.Plant,
        StorageLocation: goodsIssue.StorageLocation,
        GoodsMovementType: '241',
        EntryUnit: 'EA',
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

const orchestrate = async (request) => {
  const payload = await readJson(request)
  const { goodsIssue: requestedGoodsIssue, asset } = payload
  const grn = await getGrnDetails(requestedGoodsIssue?.GrnNumber)
  const goodsIssue = {
    ...requestedGoodsIssue,
    PostingDate: grn.postingDate,
    DocumentDate: grn.documentDate,
    Material: grn.material,
    Plant: grn.plant,
    StorageLocation: grn.storageLocation,
    EntryUnit: grn.entryUnit,
    QuantityInEntryUnit: String(grn.quantity),
    SerialNumbers: grn.serialNumbers,
  }
  validatePayload({ goodsIssue, asset })

  const quantity = grn.quantity
  const serialNumbers = grn.serialNumbers
  const capitalizationDate = grn.postingDateISO
  if (!capitalizationDate) {
    throw Object.assign(new Error('A valid GRN posting date is required for asset capitalization.'), { statusCode: 400 })
  }
  const resumeAssetNumbers = Array.isArray(payload.resumeAssetNumbers)
    ? payload.resumeAssetNumbers.map(String).filter(required)
    : []
  if (resumeAssetNumbers.length > 0 && resumeAssetNumbers.length !== quantity) {
    throw Object.assign(new Error('The number of recovery assets must match the GRN quantity.'), { statusCode: 400 })
  }
  const createdAssets = resumeAssetNumbers.map((masterFixedAsset, index) => ({
    index: index + 1,
    serialNumber: serialNumbers[index],
    masterFixedAsset,
    resumed: true,
  }))

  for (let index = resumeAssetNumbers.length; index < quantity; index += 1) {
    const assetPayload = buildAssetPayload(asset, serialNumbers[index], capitalizationDate)
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
      serialNumber: serialNumbers[index],
      masterFixedAsset,
      assetPayload,
      assetResponse,
    })
  }
  const assetNumbers = createdAssets.map((item) => item.masterFixedAsset)
  const goodsIssuePayload = buildGoodsIssuePayload(goodsIssue, assetNumbers, serialNumbers)
  let goodsIssueResponse
  try {
    goodsIssueResponse = await sapRequest(ENDPOINTS.goodsIssue, 'POST', goodsIssuePayload)
  } catch (error) {
    error.partialResult = { assetNumbers, serialNumbers }
    const stockDeficit = getStockDeficitMessage(error.detail)
    if (stockDeficit) {
      error.message = `241 goods issue cannot be posted because unrestricted-use stock is insufficient. ${stockDeficit}. Add or release the required stock in SAP, then click Create All again; the existing asset numbers will be reused.`
    }
    throw error
  }

  return {
    grn,
    assetNumbers,
    serialNumbers,
    createdAssets,
    goodsIssuePayload,
    goodsIssueResponse,
  }
}

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

  sendJson(response, 404, { error: `API route not found: ${request.method} ${pathname}` })
})

server.listen(PORT, () => {
  console.log(`Asset creation API running on http://localhost:${PORT}`)
})
