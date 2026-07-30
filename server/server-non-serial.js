// Non-serial-managed GRN processing.  This module deliberately creates one
// asset and one 241 posting item for the full GRN quantity.
export const buildNonSerialProjectStockTransferPayload = ({ grnItem, parseSapDate, toODataV2Date }) => {
  const postingDate = parseSapDate(grnItem.postingDate)
  const documentDate = parseSapDate(grnItem.documentDate)
  return {
    GoodsMovementCode: '04',
    PostingDate: postingDate ? toODataV2Date(postingDate) : grnItem.postingDate,
    DocumentDate: documentDate ? toODataV2Date(documentDate) : grnItem.documentDate,
    to_MaterialDocumentItem: {
      results: [{
        Material: grnItem.material,
        Plant: grnItem.plant,
        StorageLocation: grnItem.storageLocation,
        GoodsMovementType: '411',
        EntryUnit: grnItem.entryUnit || 'EA',
        QuantityInEntryUnit: String(grnItem.quantity),
        InventorySpecialStockType: grnItem.inventorySpecialStockType || undefined,
        SpecialStockIdfgWBSElement: grnItem.wbsElement || undefined,
        IssuingOrReceivingPlant: grnItem.plant,
        IssuingOrReceivingStorageLoc: grnItem.storageLocation,
      }],
    },
  }
}

export const createSingleAssetForNonSerial = async ({
  grnItem,
  goodsIssueItem,
  asset,
  productGroup,
  assetClass,
  resumeAssetNumbers = [],
  persistProgress = false,
  buildAssetPayload,
  extractAssetNumber,
  sapRequest,
  fixedAssetCreateEndpoint,
  fixedAssetCollectionEndpoint,
  goodsIssueEndpoint,
  updateProcessedItem,
  parseSapDate,
  toODataV2Date,
}) => {
  if (resumeAssetNumbers.length > 1) {
    throw Object.assign(new Error(`Recovery asset count is greater than one for non-serial GRN item ${grnItem.key}.`), {
      statusCode: 400,
    })
  }

  const createdAssets = resumeAssetNumbers.map((masterFixedAsset) => ({
    index: 1,
    serialNumber: '',
    masterFixedAsset,
    resumed: true,
  }))

  if (createdAssets.length === 0) {
    const assetPayload = buildAssetPayload(asset, '', grnItem.postingDateISO)
    const assetResponse = await sapRequest(fixedAssetCreateEndpoint, 'POST', assetPayload, {
      tokenPath: fixedAssetCollectionEndpoint,
    })
    createdAssets.push({
      index: 1,
      serialNumber: '',
      masterFixedAsset: extractAssetNumber(assetResponse),
      assetPayload,
      assetResponse,
    })
  }

  const assetNumbers = createdAssets.map((item) => item.masterFixedAsset)
  if (persistProgress) {
    await updateProcessedItem(grnItem.key, {
      status: 'assets-created',
      assetNumbers,
      serialNumbers: [],
      poDescription: grnItem.poDescription,
      productGroup,
      assetClass,
      material: grnItem.material,
      materialDocument: grnItem.grnNumber,
      materialDocumentYear: grnItem.materialDocumentYear,
      materialDocumentItem: grnItem.materialDocumentItem,
    })
  }

  const postingDate = parseSapDate(grnItem.postingDate)
  const documentDate = parseSapDate(grnItem.documentDate)
  const goodsIssuePayload = {
    GoodsMovementCode: grnItem.goodsMovementCode || '03',
    MaterialDocumentHeaderText: grnItem.materialDocumentHeaderText || undefined,
    PostingDate: postingDate ? toODataV2Date(postingDate) : grnItem.postingDate,
    DocumentDate: documentDate ? toODataV2Date(documentDate) : grnItem.documentDate,
    to_MaterialDocumentItem: {
      results: [{
        Material: goodsIssueItem.material,
        Plant: goodsIssueItem.plant,
        StorageLocation: goodsIssueItem.storageLocation,
        GoodsMovementType: grnItem.goodsMovementType || '241',
        EntryUnit: goodsIssueItem.entryUnit || 'EA',
        // SAP values this single asset from the full posted GRN quantity.
        QuantityInEntryUnit: String(grnItem.quantity),
        MasterFixedAsset: assetNumbers[0],
      }],
    },
  }

  let goodsIssueResponse
  try {
    goodsIssueResponse = await sapRequest(goodsIssueEndpoint, 'POST', goodsIssuePayload)
  } catch (error) {
    error.partialResult = { assetNumbers, serialNumbers: [] }
    throw error
  }

  return {
    grn: grnItem,
    productGroup,
    assetClass,
    assetNumbers,
    serialNumbers: [],
    createdAssets,
    goodsIssuePayload,
    goodsIssueResponse,
  }
}
