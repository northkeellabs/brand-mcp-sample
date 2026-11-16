// Figma Variables -> DTCG 2025.10 exporter (read-only). Runs inside a Figma plugin.
// Conventions: collection "Primitives" holds shared tokens; a primitive whose first name
// segment is a brand ("tarnbury/color/palette/oat") is routed to that brand's file without the prefix.
// Brands come either from collections named "Brand: <Name>" (one mode each, works on every Figma plan)
// or from one collection named "Brand" with one mode per brand (needs a plan with several modes).
// Figma stores numbers as 32-bit floats, so every number is rounded to 4 decimals (1.149999976 -> 1.15).
async function exportDtcg(figmaApi) {
  const collections = await figmaApi.variables.getLocalVariableCollectionsAsync();
  const vars = await figmaApi.variables.getLocalVariablesAsync();
  const byId = Object.fromEntries(vars.map(v => [v.id, v]));
  const collById = Object.fromEntries(collections.map(c => [c.id, c]));
  const BP = 'Brand: ';
  const brands = new Set();
  for (const c of collections) {
    if (c.name.startsWith(BP)) brands.add(c.name.slice(BP.length).toLowerCase());
    else if (c.name === 'Brand') c.modes.forEach(m => brands.add(m.name.toLowerCase()));
  }
  function route(v) {
    const p = v.name.split('/');
    const c = collById[v.variableCollectionId];
    if (c.name.startsWith(BP)) return { file: c.name.slice(BP.length).toLowerCase(), path: p };
    if (brands.has(p[0].toLowerCase())) return { file: p[0].toLowerCase(), path: p.slice(1) };
    return { file: 'base', path: p };
  }
  const r4 = x => Math.round(x * 10000) / 10000;
  const h2 = x => Math.round(x * 255).toString(16).padStart(2, '0');
  function typeOf(v) {
    if (v.resolvedType === 'COLOR') return 'color';
    if (v.resolvedType === 'STRING') return v.scopes.includes('FONT_FAMILY') ? 'fontFamily' : 'string';
    if (v.resolvedType === 'FLOAT') {
      if (v.scopes.includes('FONT_WEIGHT')) return 'fontWeight';
      if (v.scopes.includes('LINE_HEIGHT') || v.scopes.includes('OPACITY')) return 'number';
      return 'dimension';
    }
    return 'string';
  }
  function valueOf(raw, type) {
    if (raw && raw.type === 'VARIABLE_ALIAS') return '{' + route(byId[raw.id]).path.join('.') + '}';
    if (type === 'color') return { colorSpace: 'srgb', components: [r4(raw.r), r4(raw.g), r4(raw.b)], alpha: r4(raw.a), hex: '#' + h2(raw.r) + h2(raw.g) + h2(raw.b) };
    if (type === 'dimension') return { value: r4(raw), unit: 'px' };
    if (type === 'fontFamily') return String(raw).split(',').map(s => s.trim()).filter(Boolean);
    if (typeof raw === 'number') return r4(raw);
    return raw;
  }
  const files = {};
  for (const v of vars) {
    const c = collById[v.variableCollectionId];
    const modes = c.name === 'Brand' ? c.modes : [c.modes[0]];
    for (const m of modes) {
      const r = route(v);
      const file = c.name === 'Brand' ? m.name.toLowerCase() : r.file;
      const type = typeOf(v);
      let node = (files[file] = files[file] || {});
      for (const p of r.path.slice(0, -1)) node = (node[p] = node[p] || {});
      const tok = { $type: type, $value: valueOf(v.valuesByMode[m.modeId], type) };
      if (v.description) tok.$description = v.description;
      tok.$extensions = { 'com.figma': { variableId: v.id } };
      node[r.path[r.path.length - 1]] = tok;
    }
  }
  return files;
}
if (typeof module !== 'undefined') module.exports = { exportDtcg };

// Plugin entry: the build step concatenates export-dtcg.js before this file into dist/code.js.
figma.showUI(__html__, { width: 520, height: 420 });
exportDtcg(figma).then(files => figma.ui.postMessage({ type: 'files', files }));
