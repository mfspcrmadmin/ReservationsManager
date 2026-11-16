import { documentImagesConfig } from './document-images-config.js';

const identifier = value => /^[a-zA-Z0-9_-]+$/.test(String(value || ''));
const timeout = (promise, milliseconds = 20000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Image loading timed out. Retry.')), milliseconds);
  Promise.resolve(promise).then(resolve, reject).finally(() => clearTimeout(timer));
});
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
export function imageSuppliers(group, records) {
  const rows = Object.values(records || {}).filter(row => row.module === 'Booking_Services' &&
    (group.service_id ? String(row.id) === String(group.service_id) : group.step_id && String(row.step_id) === String(group.step_id)));
  return [...new Map(rows.filter(row => /^\d+$/.test(row.supplier_id || '')).map(row =>
    [row.supplier_id, { id: row.supplier_id, name: row.supplier || 'Supplier' }])).values()];
}
export function createDocumentImagesAPI({ crm, config = documentImagesConfig, prepareImage, invokeFunction } = {}) {
  const pending = new Map();
  const selections = new Map();
  const applied = new Map();
  async function invokeImage(values) {
    const functions = window.ZOHO?.CRM?.FUNCTIONS;
    if (!config.prepareFunction || (!invokeFunction && !functions?.execute)) throw new Error('Document image publishing is not configured yet. Your current image has been kept.');
    const invoke = invokeFunction || ((name, request) => functions.execute(name, request));
    let result = await invoke(config.prepareFunction, { arguments: JSON.stringify({requestBody: JSON.stringify(values)}) });
    for (let depth=0; depth<8; depth++) {
      result = parse(result);
      if (result?.status === 'OK') return result;
      if (result?.status === 'ERROR') throw Object.assign(new Error((result.message || 'Image preparation failed. Retry.') + (result.stage ? ' (' + result.stage + (result.workdrive_code ? ': ' + result.workdrive_code : '') + ')' : '')), {stage:result.stage,code:result.workdrive_code});
      const next = result?.details?.output ?? result?.response ?? result?.result;
      if (next == null) break;
      result = next;
    }
    throw new Error('CRM did not confirm image preparation. Check that prepareDocumentImage has REST OAuth enabled.');
  }
  async function prepare(values) {
    return prepareImage ? prepareImage(values) : invokeImage(values);
  }
  async function request(folder, supplierId, offset) {
    const result = await timeout(invokeImage({ operation: 'list', supplier_id: supplierId, folder_id: folder, offset }));
    if (!Array.isArray(result.data)) throw new Error('CRM did not return the supplier image library. Retry.');
    return result;
  }
  async function list(folder, supplierId) {
    if (!identifier(folder)) throw new Error('The supplier WorkDrive folder ID is invalid.');
    const files = new Map();
    for (let offset = 0; offset < 10000; offset += 50) {
      const result = await request(folder, supplierId, offset);
      for (const row of result.data) files.set(row.id, row);
      if (result.data.length < 50) return [...files.values()];
    }
    throw new Error('This image folder is too large to load completely. Use a smaller General folder.');
  }
  async function child(parent, name, supplierId) {
    const matches = (await list(parent, supplierId)).filter(file => (file.attributes?.is_folder === true || file.attributes?.type === 'folder') &&
      String(file.attributes?.name || '').trim().toLowerCase() === name.toLowerCase());
    if (matches.length > 1) throw new Error('More than one ' + name + ' folder exists. Resolve the duplicate folders before selecting an image.');
    return matches[0]?.id;
  }
  async function load(supplier) {
    const api = crm || window.ZOHO?.CRM?.API;
    const record = (await timeout(api?.getRecord({ Entity: 'Vendors', RecordID: supplier.id })))?.data?.[0];
    if (String(record?.id) !== supplier.id) throw new Error('Could not load the supplier. Retry.');
    const folder = String(record.Workdrive_ID || '').trim();
    if (!folder) return { status: 'no-folder', files: [] };
    if (!identifier(folder)) throw new Error('The supplier Workdrive ID must contain a folder ID.');
    const folderUrl = 'https://workdrive.zoho.eu/folder/' + folder;
    const images = await child(folder, 'Images', supplier.id);
    if (!images) return { status: 'no-images', folderUrl, files: [] };
    const general = await child(images, 'General', supplier.id);
    if (!general) return { status: 'no-general', folderUrl, files: [] };
    const files = (await list(general, supplier.id)).filter(file => !file.attributes?.is_folder &&
      /\.(jpe?g|png|webp)$/i.test(file.attributes?.name || '')).map(file => ({
      id: file.id, name: file.attributes.name, thumbnail: file.attributes.thumbnail_url || '',
      modified: file.attributes.modified_time_in_millisecond,
      cover: /^step-cover\.(jpe?g|png|webp)$/i.test(file.attributes.name)
    })).sort((a,b) => Number(b.cover) - Number(a.cover) || a.name.localeCompare(b.name));
    return { status: files.length ? 'ready' : 'empty', folderUrl, files };
  }
  return {
    appliedURL(file) { return applied.get(file.id+':'+file.modified); },
    // Coalesce simultaneous requests, but reload on each explicit opening/retry.
    load(supplier) {
      if (!pending.has(supplier.id)) pending.set(supplier.id, load(supplier).finally(() => pending.delete(supplier.id)));
      return pending.get(supplier.id);
    },
    async select(supplier, file) {
      // The publisher must copy to immutable public storage; never expose a vendor folder.
      const key = supplier.id + ':' + file.id + ':' + file.modified;
      if (!selections.has(key)) selections.set(key, timeout(prepare({ supplier_id: supplier.id, file_id: file.id, modified: file.modified }), 60000).finally(() => selections.delete(key)));
      const result = await selections.get(key);
      const url = String(result?.url || '');
      if (!/^https:\/\//.test(url) || url.length > 255) throw new Error('The prepared image did not return a valid document URL.');
      applied.set(file.id+':'+file.modified,url);
      return url;
    }
  };
}
