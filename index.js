const fs = require('fs');
const path = require('path');
const http = require('http');

// 1. Attribute parser for SVG tags
function parseAttributes(tagStr) {
  const attrRegex = /([a-z0-9:-]+)\s*=\s*(['"])([\s\S]*?)\2/gi;
  const attrs = {};
  let match;
  while ((match = attrRegex.exec(tagStr)) !== null) {
    attrs[match[1]] = match[3];
  }
  return attrs;
}

// 2. Attribute formatter / Tag rebuilder
function rebuildOpeningTag(tagName, attrs, isSelfClosing) {
  let tagStr = `<${tagName}`;
  for (const [key, val] of Object.entries(attrs)) {
    tagStr += ` ${key}="${val}"`;
  }
  tagStr += isSelfClosing ? ' />' : '>';
  return tagStr;
}

// 3. Path Parser to extract coordinates and compute bounding box
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

// 4. Matrix Parser
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

// 5. Transform point
function transformPoint(pt, matrix) {
  const [a, b, c, d, e, f] = matrix;
  return {
    x: a * pt.x + c * pt.y + e,
    y: b * pt.x + d * pt.y + f
  };
}

// 6. Matrix Multiplication
function multiplyMatrices(A, B) {
  const [a1, b1, c1, d1, e1, f1] = A;
  const [a2, b2, c2, d2, e2, f2] = B;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1
  ];
}

// 7. Room text to palette color mapping
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
  if (t.includes('césped') || t.includes('cesped') || t.includes('jardín') || t.includes('jardin') || t.includes('verde') || t.includes('grama') || t.includes('jardines') || t.includes('cancha')) {
    return '#90EE90'; // LightGreen
  }
  
  // Verde oscuro - plantas
  if (t.includes('planta') || t.includes('macetero') || t.includes('macetera') || t.includes('plantas')) {
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
  
  return '#FFE4C4'; // Fallback Bisque
}

// 8. Rebuilding sequential SVG parser with clipPath safety & white-fills colorization
function processSVG(filepath, outpath) {
  console.log(`Processing SVG: ${path.basename(filepath)}`);
  let content = fs.readFileSync(filepath, 'utf8');

  // Inject synthetic grass field path for Nivel 1 at the root level right after </defs>
  if (filepath.includes('NIVEL-1-KINAL')) {
    content = content.replace('</defs>', '</defs><path id="cancha-grass-field" transform="matrix(0.04, 0, 0, 0.04, 0, 0)" d="M 3278,1353 H 24500 V 27000 H 13100 L 3278,29500 Z" style="fill:#90EE90;stroke:none;" />');
  }

  const tagRegex = /(<g[^>]*>|<\/g>|<text[^>]*>[\s\S]*?<\/text>|<path[^>]*>|<clipPath[^>]*>|<\/clipPath>)/gi;
  
  // --- PASS 1: Collect room texts and their absolute coordinates ---
  const transformStack = [[1, 0, 0, 1, 0, 0]];
  const roomTexts = [];
  
  const layoutKeywords = [
    'PLANTA', 'ESCALA', 'CONSTRUYE', 'PROPIETARIO', 'EJECUTOR', 'CONTENIDO', 
    'PROYECTO', 'DISEÑO', 'DIBUJO', 'FECHA', 'MAYO', 'TIMBRE', 'HOJA', 
    'FIRMA', 'OBSERVACIONES', 'MARGEN', 'CAJETIN', 'KINAL', 'FIRMA Y SELLO', 
    'ESCALA INDICADA', 'AREA DE AMBIENTES', 'Y CIRCULACION', 'C.S.C.M', 'RUTAS DE EVACUACIÓN',
    'NIVEL', 'PRIMER', 'SEGUNDO', 'TERCER', 'CUARTO'
  ];

  // Manually add Canva Grass Field mock label in Pass 1 for Nivel 1
  if (filepath.includes('NIVEL-1-KINAL')) {
    roomTexts.push({
      id: 'cancha-grass-field-label',
      text: 'cancha',
      pos: { x: 500, y: 600 }
    });
  }

  let match;
  let inClipPath = false;
  tagRegex.lastIndex = 0;
  while ((match = tagRegex.exec(content)) !== null) {
    const tag = match[0];
    
    if (tag.startsWith('<clipPath') || tag.startsWith('<clipPath')) {
      inClipPath = true;
      continue;
    } else if (tag.startsWith('</clipPath') || tag.startsWith('</clipPath')) {
      inClipPath = false;
      continue;
    }
    
    if (inClipPath) continue;
    
    if (tag.startsWith('<g') || tag.startsWith('<G')) {
      const transformMatch = tag.match(/\btransform="([^"]+)"/i);
      const parentM = transformStack[transformStack.length - 1];
      if (transformMatch) {
        const localM = parseMatrix(transformMatch[1]);
        const combinedM = multiplyMatrices(parentM, localM);
        transformStack.push(combinedM);
      } else {
        transformStack.push(parentM);
      }
    } else if (tag === '</g>' || tag === '</G>') {
      if (transformStack.length > 1) {
        transformStack.pop();
      }
    } else if (tag.startsWith('<text') || tag.startsWith('<TEXT')) {
      const textInnerMatch = tag.match(/<text[^>]*>([\s\S]*?)<\/text>/i);
      if (!textInnerMatch) continue;
      const textInner = textInnerMatch[1];
      const tspanMatch = textInner.match(/<tspan[^>]*>([\s\S]*?)<\/tspan>/i);
      let textVal = tspanMatch ? tspanMatch[1] : textInner;
      textVal = textVal.replace(/<[^>]*>/g, '').trim();
      
      if (textVal) {
        const idMatch = tag.match(/\bid="([^"]+)"/i);
        const transformMatch = tag.match(/\btransform="([^"]+)"/i);
        
        const localM = parseMatrix(transformMatch ? transformMatch[1] : null);
        const parentM = transformStack[transformStack.length - 1];
        const absM = multiplyMatrices(parentM, localM);
        
        let x = 0, y = 0;
        const xMatch = tag.match(/\bx="([^"]+)"/i);
        const yMatch = tag.match(/\by="([^"]+)"/i);
        if (xMatch) x = parseFloat(xMatch[1]);
        if (yMatch) y = parseFloat(yMatch[1]);
        
        const pt = transformPoint({ x, y }, absM);
        
        const isLayout = layoutKeywords.some(kw => textVal.toUpperCase().includes(kw)) ||
                        pt.x >= 2850 ||
                        (pt.x >= 2800 && (textVal.length <= 2 || /^[A-Z]$/.test(textVal)));
                        
        if (!isLayout) {
          roomTexts.push({
            id: idMatch ? idMatch[1] : 'unknown',
            text: textVal,
            pos: pt
          });
        }
      }
    }
  }

  console.log(`Collected ${roomTexts.length} room label texts.`);
  
  // --- PASS 2: Reconstruct SVG, colorize geometries and hide layout elements ---
  let output = '';
  let lastIndex = 0;
  transformStack.length = 1;
  transformStack[0] = [1, 0, 0, 1, 0, 0];
  
  let coloredCount = 0;
  let fallbackCount = 0;
  inClipPath = false;

  tagRegex.lastIndex = 0;
  while ((match = tagRegex.exec(content)) !== null) {
    const tag = match[0];
    const startIndex = match.index;
    
    // Append content before tag
    output += content.substring(lastIndex, startIndex);
    lastIndex = tagRegex.lastIndex;
    
    let modifiedTag = tag;
    
    if (tag.startsWith('<clipPath') || tag.startsWith('<clipPath')) {
      inClipPath = true;
      output += tag;
      continue;
    } else if (tag.startsWith('</clipPath') || tag.startsWith('</clipPath')) {
      inClipPath = false;
      output += tag;
      continue;
    }
    
    if (inClipPath) {
      output += tag;
      continue;
    }
    
    if (tag.startsWith('<g') || tag.startsWith('<G')) {
      const attrs = parseAttributes(tag);
      const parentM = transformStack[transformStack.length - 1];
      if (attrs['transform']) {
        const localM = parseMatrix(attrs['transform']);
        const combinedM = multiplyMatrices(parentM, localM);
        transformStack.push(combinedM);
      } else {
        transformStack.push(parentM);
      }
      
      const id = attrs['id'] || '';
      const label = attrs['inkscape:label'] || '';
      
      const isLayoutGroup = /MARGEN|CAJETIN|firmas|Firmas/i.test(label) || 
                            /MARGEN|CAJETIN/i.test(id) || 
                            ['layer-oc2', 'layer-oc4', 'layer-oc6', 'g120912', 'g120914'].includes(id);
                            
      if (isLayoutGroup) {
        if (attrs['style']) {
          attrs['style'] = attrs['style'] + ';display:none;';
        } else {
          attrs['style'] = 'display:none;';
        }
        modifiedTag = rebuildOpeningTag('g', attrs, false);
      }
      
    } else if (tag === '</g>' || tag === '</G>') {
      if (transformStack.length > 1) {
        transformStack.pop();
      }
    } else if (tag.startsWith('<text') || tag.startsWith('<TEXT')) {
      const textInnerMatch = tag.match(/<text[^>]*>([\s\S]*?)<\/text>/i);
      if (textInnerMatch) {
        const textInner = textInnerMatch[1];
        const tspanMatch = textInner.match(/<tspan[^>]*>([\s\S]*?)<\/tspan>/i);
        let textVal = tspanMatch ? tspanMatch[1] : textInner;
        textVal = textVal.replace(/<[^>]*>/g, '').trim();
        
        const openTagMatch = tag.match(/^<text[^>]*>/i);
        const openTag = openTagMatch[0];
        const attrs = parseAttributes(openTag);
        
        const localM = parseMatrix(attrs['transform']);
        const parentM = transformStack[transformStack.length - 1];
        const absM = multiplyMatrices(parentM, localM);
        
        let x = 0, y = 0;
        if (attrs['x']) x = parseFloat(attrs['x']);
        if (attrs['y']) y = parseFloat(attrs['y']);
        const pt = transformPoint({ x, y }, absM);
        
        const isLayout = layoutKeywords.some(kw => textVal.toUpperCase().includes(kw)) ||
                        pt.x >= 2850 ||
                        (pt.x >= 2800 && (textVal.length <= 2 || /^[A-Z]$/.test(textVal)));
                        
        if (isLayout) {
          if (attrs['style']) {
            attrs['style'] = attrs['style'] + ';display:none;';
          } else {
            attrs['style'] = 'display:none;';
          }
          const rebuiltOpen = rebuildOpeningTag('text', attrs, false);
          modifiedTag = rebuiltOpen + tag.substring(openTag.length);
        }
      }
    } else if (tag.startsWith('<path') || tag.startsWith('<PATH')) {
      const isSelfClosing = tag.trim().endsWith('/>');
      const attrs = parseAttributes(tag);
      
      if (attrs['d']) {
        const d = attrs['d'];
        const localM = parseMatrix(attrs['transform']);
        const parentM = transformStack[transformStack.length - 1];
        const absM = multiplyMatrices(parentM, localM);
        
        const points = parseSvgPath(d);
        if (points.length > 0) {
          const transformedPoints = points.map(pt => transformPoint(pt, absM));
          const xs = transformedPoints.map(p => p.x);
          const ys = transformedPoints.map(p => p.y);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          const center = { x: (minX + maxX)/2, y: (minY + maxY)/2 };
          const area = (maxX - minX) * (maxY - minY);
          const width = maxX - minX;
          const height = maxY - minY;
          
          if (area >= 5000000) {
            // Hide global page border
            if (attrs['style']) {
              attrs['style'] = attrs['style'] + ';display:none;';
            } else {
              attrs['style'] = 'display:none;';
            }
            modifiedTag = rebuildOpeningTag('path', attrs, isSelfClosing);
          } else {
            // Check if it is a level underline path
            const isLevelUnderline = height === 0 && 
                                     Math.abs(width - 344.5) < 5 && 
                                     (center.y > 1700 && center.y < 1900) &&
                                     (center.x > 1400 && center.x < 1800);
                                     
            if (isLevelUnderline) {
              if (attrs['style']) {
                attrs['style'] = attrs['style'] + ';display:none;';
              } else {
                attrs['style'] = 'display:none;';
              }
              modifiedTag = rebuildOpeningTag('path', attrs, isSelfClosing);
            } else {
              const style = attrs['style'] || '';
              const fillAttr = attrs['fill'] || '';
              
              const isWhiteFill = fillAttr.toLowerCase() === '#ffffff' || 
                                  fillAttr.toLowerCase() === '#fff' || 
                                  fillAttr.toLowerCase() === 'white' ||
                                  style.toLowerCase().includes('fill:#ffffff') ||
                                  style.toLowerCase().includes('fill:#fff') ||
                                  style.toLowerCase().includes('fill:white') ||
                                  (!style.includes('fill:') && !attrs['fill']);
                                  
              const isNoFillOutline = style.toLowerCase().includes('fill:none') && 
                                      style.toLowerCase().includes('stroke:#000000') &&
                                      area > 200 && width > 5 && height > 5;
                                      
              if ((isWhiteFill || isNoFillOutline) && center.x < 2850 && width > 2 && height > 2) {
                // Reverted to robust 200 units matching limit to prevent color bleeding in Nivel 1
                let closestText = null;
                let minDist = Infinity;
                
                roomTexts.forEach(rt => {
                  const dist = Math.hypot(center.x - rt.pos.x, center.y - rt.pos.y);
                  if (dist < minDist) {
                    minDist = dist;
                    closestText = rt;
                  }
                });
                
                if (closestText && minDist < 200) {
                  const color = getColorForText(closestText.text);
                  
                  let newStyle = '';
                  if (attrs['style']) {
                    const style = attrs['style'];
                    if (style.includes('fill:')) {
                      newStyle = style.replace(/fill:\s*[^;]+/, `fill:${color}`);
                    } else {
                      newStyle = style + `;fill:${color}`;
                    }
                  } else {
                    newStyle = `fill:${color}`;
                  }
                  attrs['style'] = newStyle;
                  modifiedTag = rebuildOpeningTag('path', attrs, isSelfClosing);
                  coloredCount++;
                } else {
                  fallbackCount++;
                }
              }
            }
          }
        }
      }
    }
    
    output += modifiedTag;
  }
  
  // Append remaining content
  output += content.substring(lastIndex);
  
  console.log(`Colorized: ${coloredCount} room paths, ${fallbackCount} fallback paths.`);
  fs.writeFileSync(outpath, output, 'utf8');
}

// 9. Run colorization on all SVG files
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

console.log(`Colorizing maps...`);
const files = fs.readdirSync(mapsDir).filter(f => f.toLowerCase().endsWith('.svg'));
files.forEach(file => {
  const filepath = path.join(mapsDir, file);
  const outpath = path.join(outputDir, file);
  processSVG(filepath, outpath);
});

console.log('All SVG files processed successfully!');

// 10. Start interactive local Web Server
const server = http.createServer((req, res) => {
  const url = req.url;
  
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
  } else if (url === '/api/save-map' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const filename = payload.filename;
        const svgContent = payload.svg;
        const filepath = path.join(outputDir, filename);
        fs.writeFileSync(filepath, svgContent, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        console.error('Error saving map:', err);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(err.message);
      }
    });
  } else if (url.startsWith('/api/maps/')) {
    const filename = decodeURIComponent(url.substring(10));
    const filepath = path.join(outputDir, filename);
    if (fs.existsSync(filepath)) {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' });
      res.end(fs.readFileSync(filepath));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log('\n=========================================');
  console.log(`Local Map Viewer started successfully!`);
  console.log(`Open your browser and navigate to: http://localhost:${PORT}`);
  console.log(`Press Ctrl+C to stop the server.`);
  console.log('=========================================');
});
