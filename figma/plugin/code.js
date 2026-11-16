// Plugin entry: the build step concatenates export-dtcg.js before this file into dist/code.js.
figma.showUI(__html__, { width: 520, height: 420 });
exportDtcg(figma).then(files => figma.ui.postMessage({ type: 'files', files }));
