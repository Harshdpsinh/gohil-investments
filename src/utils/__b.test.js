import { it } from 'vitest'
import { readFileSync, writeFileSync } from 'fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
it('dump', async () => {
  const doc=await pdfjs.getDocument({data:new Uint8Array(readFileSync('C:/Users/harsh/OneDrive/Desktop/BILL HARSHDEEPSINH GOHIL.pdf'))}).promise
  let out=`pages=${doc.numPages}\n`
  for(let n=1;n<=doc.numPages;n++){
    const tc=await (await doc.getPage(n)).getTextContent(); const m=new Map()
    for(const i of tc.items){ if(!i.str.trim())continue; const y=Math.round(i.transform[5]); if(!m.has(y))m.set(y,[]); m.get(y).push({x:i.transform[4],s:i.str.trim()}) }
    const lines=[...m.entries()].sort((a,b)=>b[0]-a[0])
    out+=`\n##### PAGE ${n}  lines=${lines.length}\n`
    lines.forEach(([y,c])=>{ out+=String(y).padStart(5)+'  '+c.sort((a,b)=>a.x-b.x).map(i=>`${Math.round(i.x)}:${i.s}`).join(' | ')+'\n' })
  }
  writeFileSync('C:/Users/harsh/AppData/Local/Temp/bill.txt',out)
}, 300000)
