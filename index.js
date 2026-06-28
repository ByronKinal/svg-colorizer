const fs = require('fs');
const path = require('path');

// 1. Path Parser to extract coordinates and compute bounding box
function parseSvgPath(d) {
  const tokens = d.match(/[a-df-zXZ]|-?\d+(\.\d+)?/gi) || [];
  const points = [];
  let curX = 0;
  let curY = 0;
  let i = 0;
  let currentCmd = '';
  
  while (i < tokens.length) {
    const token = tokens[i];
    if (/[a-df-zXZ]/i.test(token)) {
      currentCmd = token;
      i++;
      continue;
    }
    
    if (currentCmd === 'M' || currentCmd === 'L') {
      const x = parseFloat(tokens[i]);
      const y = parseFloat(tokens[i+1]);
      curX = x;
      curY = y;
      points.push({ x, y });
      i += 2;
    } else if (currentCmd === 'm' || currentCmd === 'l') {
      const dx = parseFloat(tokens[i]);
      const dy = parseFloat(tokens[i+1]);
      curX += dx;
      curY += dy;
      points.push({ x: curX, y: curY });
      i += 2;
    } else if (currentCmd === 'H') {
      const x = parseFloat(tokens[i]);
      curX = x;
      points.push({ x: curX, y: curY });
      i++;
    } else if (currentCmd === 'h') {
      const dx = parseFloat(tokens[i]);
      curX += dx;
      points.push({ x: curX, y: curY });
      i++;
    } else if (currentCmd === 'V') {
      const y = parseFloat(tokens[i]);
      curY = y;
      points.push({ x: curX, y: curY });
      i++;
    } else if (currentCmd === 'v') {
      const dy = parseFloat(tokens[i]);
      curY += dy;
      points.push({ x: curX, y: curY });
      i++;
    } else if (currentCmd === 'C') {
      const x = parseFloat(tokens[i+4]);
      const y = parseFloat(tokens[i+5]);
      curX = x;
      curY = y;
      points.push({ x, y });
      i += 6;
    } else if (currentCmd === 'c') {
      const dx = parseFloat(tokens[i+4]);
      const dy = parseFloat(tokens[i+5]);
      curX += dx;
      curY += dy;
      points.push({ x: curX, y: curY });
      i += 6;
    } else if (currentCmd === 'S') {
      const x = parseFloat(tokens[i+2]);
      const y = parseFloat(tokens[i+3]);
      curX = x;
      curY = y;
      points.push({ x, y });
      i += 4;
    } else if (currentCmd === 's') {
      const dx = parseFloat(tokens[i+2]);
      const dy = parseFloat(tokens[i+3]);
      curX += dx;
      curY += dy;
      points.push({ x: curX, y: curY });
      i += 4;
    } else {
      i++;
    }
  }
  return points;
}

// 2. Matrix Parser
function parseMatrix(transformStr) {
  if (!transformStr || transformStr === 'none') {
    return [1, 0, 0, 1, 0, 0];
  }
  const match = transformStr.match(/matrix\(([^)]+)\)/);
  if (match) {
    return match[1].split(',').map(s => parseFloat(s.trim()));
  }
  const translateMatch = transformStr.match(/translate\(([^)]+)\)/);
  if (translateMatch) {
    const parts = translateMatch[1].split(',').map(s => parseFloat(s.trim()));
    return [1, 0, 0, 1, parts[0], parts[1] || 0];
  }
  return [1, 0, 0, 1, 0, 0];
}

// 3. Transform point
function transformPoint(pt, matrix) {
  const [a, b, c, d, e, f] = matrix;
  return {
    x: a * pt.x + c * pt.y + e,
    y: b * pt.x + d * pt.y + f
  };
}

// 4. Room text to palette color mapping
function getColorForText(text) {
  const t = text.toLowerCase().trim();
  
  // Azul - baños
  if (t.match(/^b\s*\d+$/) || t === 's.s.' || t === 'ss' || t === 's.s' || t.includes('baño') || t.includes('sanitario')) {
    return '#1E90FF'; // DodgerBlue
  }
  
  // Rojo - conexión a otro nivel (stairs, ramps)
  if (t === 's' || t === 'b' || t.includes('rampa') || t.includes('gradas') || t.includes('escalera') || t.includes('elevador') || t.includes('ascensor') || t.includes('conexion') || t.includes('conexión')) {
    return '#FF4500'; // OrangeRed
  }
  
  // Verde claro - césped/jardines
  if (t.includes('césped') || t.includes('cesped') || t.includes('jardín') || t.includes('jardin') || t.includes('verde') || t.includes('grama')) {
    return '#90EE90'; // LightGreen
  }
  
  // Verde oscuro - plantas
  if (t.includes('planta') || t.includes('macetero') || t.includes('macetera')) {
    return '#228B22'; // ForestGreen
  }
  
  // Gris - suelo de concreto
  if (t.includes('concreto') || t.includes('pasillo') || t.includes('corredor') || t.includes('vestibulo') || t.includes('lobby') || t.includes('ingreso') || t.includes('parqueo') || t.includes('plaza') || t.includes('patio')) {
    return '#D3D3D3'; // LightGrey
  }
  
  // Piel - suelo del colegio
  if (t.includes('suelo') || t.includes('colegio') || t.includes('cancha') || t.includes('patio principal')) {
    return '#FFDAB9'; // PeachPuff
  }
  
  // Naranja - salones
  const classroomKeywords = ['aula', 'sala', 'tics', 'reuniones', 'preceptoria', 'oficina', 'secretaria', 'direccion', 'coordinacion', 'orientacion', 'profesores', 'contabilidad', 'auditorio', 'fablab', 'taller', 'enfermeria', 'básicos', 'diversificado'];
  const isCode = /^[a-z](-\d+|\d+)$/i.test(t);
  if (isCode || classroomKeywords.some(kw => t.includes(kw))) {
    return '#FFA500'; // Orange
  }
  
  // Default fallback for unmatched sections (Linen)
  return '#FAF0E6';
}

// 5. Main SVG processing function
function processSVG(filepath, outpath) {
  console.log(`\n=========================================`);
  console.log(`Processing SVG: ${path.basename(filepath)}`);
  let content = fs.readFileSync(filepath, 'utf8');

  // Find all texts and their positions
  const texts = [];
  const textTagRegex = /<text[^>]*>([\s\S]*?)<\/text>/g;
  let match;
  while ((match = textTagRegex.exec(content)) !== null) {
    const fullText = match[0];
    const textInner = match[1];
    const tspanMatch = textInner.match(/<tspan[^>]*>([\s\S]*?)<\/tspan>/);
    let textVal = tspanMatch ? tspanMatch[1] : textInner;
    textVal = textVal.replace(/<[^>]*>/g, '').trim();
    
    if (!textVal) continue;

    const idMatch = fullText.match(/\bid="([^"]+)"/);
    const transformMatch = fullText.match(/\btransform="([^"]+)"/);
    const matrix = parseMatrix(transformMatch ? transformMatch[1] : null);
    const pt = transformPoint({ x: 0, y: 0 }, matrix);
    
    texts.push({
      id: idMatch ? idMatch[1] : 'unknown',
      text: textVal,
      pos: pt,
      raw: fullText
    });
  }

  // Filter out layout texts (title blocks and margins are on the right side X >= 2850)
  const layoutKeywords = [
    'PLANTA', 'ESCALA', 'CONSTRUYE', 'PROPIETARIO', 'EJECUTOR', 'CONTENIDO', 
    'PROYECTO', 'DISEÑO', 'DIBUJO', 'FECHA', 'MAYO', 'TIMBRE', 'HOJA', 
    'FIRMA', 'OBSERVACIONES', 'MARGEN', 'CAJETIN', 'KINAL', 'FIRMA Y SELLO', 
    'ESCALA INDICADA', 'AREA DE AMBIENTES', 'Y CIRCULACION', 'C.S.C.M', 'RUTAS DE EVACUACIÓN'
  ];
  
  const roomTexts = texts.filter(t => {
    // If it's on the sheet border area, filter it out
    if (t.pos.x >= 2850) return false;
    // If it's a page number or single letters like A, I, E, 04, 01 at the bottom right corner
    if (t.pos.x >= 2800 && (t.text.length <= 2 || /^[A-Z]$/.test(t.text))) return false;
    // If it contains layout keywords
    if (layoutKeywords.some(kw => t.text.toUpperCase().includes(kw))) return false;
    return true;
  });
  
  console.log(`Found ${roomTexts.length} room label texts.`);
  roomTexts.forEach(t => console.log(`  - "${t.text}" at (${t.pos.x.toFixed(1)}, ${t.pos.y.toFixed(1)})`));

  // Parse all paths in the SVG
  const paths = [];
  const pathTagRegex = /<path([^>]*)/g;
  while ((match = pathTagRegex.exec(content)) !== null) {
    const attrs = match[1];
    const idMatch = attrs.match(/\bid="([^"]+)"/);
    const dMatch = attrs.match(/\bd="([^"]+)"/);
    const transformMatch = attrs.match(/\btransform="([^"]+)"/);
    
    if (dMatch) {
      const d = dMatch[1];
      const points = parseSvgPath(d);
      if (points.length > 0) {
        const matrix = parseMatrix(transformMatch ? transformMatch[1] : null);
        const transformedPoints = points.map(pt => transformPoint(pt, matrix));
        const xs = transformedPoints.map(p => p.x);
        const ys = transformedPoints.map(p => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const center = { x: (minX + maxX)/2, y: (minY + maxY)/2 };
        const area = (maxX - minX) * (maxY - minY);
        
        paths.push({
          id: idMatch ? idMatch[1] : 'unknown',
          center,
          area,
          bbox: { minX, maxX, minY, maxY },
          rawAttrs: attrs,
          fullTag: match[0]
        });
      }
    }
  }
  
  console.log(`Parsed ${paths.length} total paths.`);

  // Colorization map
  const pathReplacements = new Map();
  let coloredCount = 0;
  let fallbackCount = 0;

  paths.forEach(p => {
    const width = p.bbox.maxX - p.bbox.minX;
    const height = p.bbox.maxY - p.bbox.minY;
    
    // Filter: must be substantial room section (area > 200, width & height > 5)
    // Avoid sheet border paths (area >= 5,000,000) and title block area (X >= 2850)
    if (p.area > 200 && p.area < 5000000 && width > 5 && height > 5) {
      if (p.center.x >= 2850) return;

      // Find closest room text
      let closestText = null;
      let minDist = Infinity;
      
      roomTexts.forEach(rt => {
        const dist = Math.hypot(p.center.x - rt.pos.x, p.center.y - rt.pos.y);
        if (dist < minDist) {
          minDist = dist;
          closestText = rt;
        }
      });
      
      // Match within 200 pixels radius
      if (closestText && minDist < 200) {
        const color = getColorForText(closestText.text);
        let newStyle = '';
        const styleMatch = p.rawAttrs.match(/style="([^"]+)"/);
        if (styleMatch) {
          const style = styleMatch[1];
          if (style.includes('fill:')) {
            newStyle = style.replace(/fill:\s*[^;]+/, `fill:${color}`);
          } else {
            newStyle = style + `;fill:${color}`;
          }
        } else {
          newStyle = `fill:${color}`;
        }
        
        pathReplacements.set(p.id, {
          oldAttrs: p.rawAttrs,
          newAttrs: p.rawAttrs.replace(/style="([^"]+)"/, `style="${newStyle}"`)
        });
        coloredCount++;
      } else {
        // Fallback for unmatched room-like sections
        // "si falta secciones que no esta definidas ponle cualquier color a esa seccion"
        // Let's use Bisque (#FFE4C4) as a beautiful neutral fallback
        const color = '#FFE4C4'; 
        let newStyle = '';
        const styleMatch = p.rawAttrs.match(/style="([^"]+)"/);
        if (styleMatch) {
          const style = styleMatch[1];
          if (style.includes('fill:')) {
            newStyle = style.replace(/fill:\s*[^;]+/, `fill:${color}`);
          } else {
            newStyle = style + `;fill:${color}`;
          }
        } else {
          newStyle = `fill:${color}`;
        }
        
        pathReplacements.set(p.id, {
          oldAttrs: p.rawAttrs,
          newAttrs: p.rawAttrs.replace(/style="([^"]+)"/, `style="${newStyle}"`)
        });
        fallbackCount++;
      }
    }
  });

  console.log(`Colorizing ${coloredCount} paths matching labels and ${fallbackCount} fallback paths...`);

  // Replace styles
  pathReplacements.forEach((val, id) => {
    content = content.replace(val.oldAttrs, val.newAttrs);
  });

  // Hide the global page border outline if it matches a massive path
  paths.forEach(p => {
    if (p.area >= 5000000) {
      // Hide the border outline
      const regex = new RegExp(`(<path[^>]*id="${p.id}"[^>]*style=")([^"]+)(")`, 'i');
      if (regex.test(content)) {
        content = content.replace(regex, `$1$2;display:none;$3`);
      } else {
        const regexNoStyle = new RegExp(`(<path[^>]*id="${p.id}"[^>]*)(>)`, 'i');
        content = content.replace(regexNoStyle, `$1 style="display:none;"$2`);
      }
    }
  });

  // 6. Cleanup of margins and title blocks:
  // Set display:none on Inkscape layers
  content = content.replace(/id="layer-oc4"[^>]*style="([^"]+)"/, (m, style) => m.replace(style, style + ';display:none'));
  content = content.replace(/id="layer-oc4"[^>]*style="/, 'id="layer-oc4" style="display:none;');
  content = content.replace(/id="layer-oc4"/, 'id="layer-oc4" style="display:none;"');

  content = content.replace(/id="layer-oc2"[^>]*style="([^"]+)"/, (m, style) => m.replace(style, style + ';display:none'));
  content = content.replace(/id="layer-oc2"[^>]*style="/, 'id="layer-oc2" style="display:none;');
  content = content.replace(/id="layer-oc2"/, 'id="layer-oc2" style="display:none;"');

  content = content.replace(/id="layer-oc6"[^>]*style="([^"]+)"/, (m, style) => m.replace(style, style + ';display:none'));
  content = content.replace(/id="layer-oc6"[^>]*style="/, 'id="layer-oc6" style="display:none;');
  content = content.replace(/id="layer-oc6"/, 'id="layer-oc6" style="display:none;"');

  // Set display:none on Nivel 1 layout groups
  content = content.replace(/id="g120914"[^>]*style="([^"]+)"/, (m, style) => m.replace(style, style + ';display:none'));
  content = content.replace(/id="g120914"[^>]*style="/, 'id="g120914" style="display:none;');
  content = content.replace(/id="g120914"/, 'id="g120914" style="display:none;"');

  content = content.replace(/id="g120912"[^>]*style="([^"]+)"/, (m, style) => m.replace(style, style + ';display:none'));
  content = content.replace(/id="g120912"[^>]*style="/, 'id="g120912" style="display:none;');
  content = content.replace(/id="g120912"/, 'id="g120912" style="display:none;"');

  // Hide the title block texts and Planta/Escala texts
  texts.forEach(t => {
    const isTitleBlockText = t.pos.x >= 2850;
    const isLayoutText = layoutKeywords.some(kw => t.text.toUpperCase().includes(kw));
    
    if (isTitleBlockText || isLayoutText) {
      const regex = new RegExp(`(<text[^>]*id="${t.id}"[^>]*style=")([^"]+)(")`, 'i');
      if (regex.test(content)) {
        content = content.replace(regex, `$1$2;display:none;$3`);
      } else {
        const regexNoStyle = new RegExp(`(<text[^>]*id="${t.id}"[^>]*)(>)`, 'i');
        content = content.replace(regexNoStyle, `$1 style="display:none;"$2`);
      }
    }
  });

  fs.writeFileSync(outpath, content, 'utf8');
  console.log(`Successfully saved colored SVG to: ${outpath}`);
}

// 6. Run the script on the target Mapas directory
const mapsDir = 'C:\\Users\\PC\\Pictures\\Mapas';
const outputDir = path.join(mapsDir, 'Coloreados');

if (!fs.existsSync(mapsDir)) {
  console.error(`Error: Directory not found: ${mapsDir}`);
  process.exit(1);
}

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
  console.log(`Created output directory: ${outputDir}`);
}

const files = fs.readdirSync(mapsDir).filter(f => f.toLowerCase().endsWith('.svg'));
files.forEach(file => {
  const filepath = path.join(mapsDir, file);
  const outpath = path.join(outputDir, file);
  processSVG(filepath, outpath);
});

console.log('\nAll SVG files processed successfully!');
