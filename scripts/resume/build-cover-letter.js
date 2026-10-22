const fs=require('fs');const {Document,Packer,Paragraph,TextRun,AlignmentType}=require('docx');
const [,,inp,out]=process.argv;const d=JSON.parse(fs.readFileSync(inp));
const run=(t,o={})=>new TextRun({text:t,font:'Arial',size:21,bold:o.bold,color:o.color});
const P=(t,o={})=>new Paragraph({spacing:{line:264,after:o.after??140},alignment:o.align,children:[run(t,o)]});
const kids=[new Paragraph({alignment:AlignmentType.LEFT,spacing:{after:40},children:[run(d.from.name,{bold:true})]}),
 P(d.from.contact,{after:240}),
 P(d.date,{after:240}), P(d.to,{after:240}), P('Re: '+d.re,{bold:true,after:240}), ...d.paras.map(p=>P(p)), P('Kind regards,',{after:40}), P(d.from.name)];
const doc=new Document({styles:{default:{document:{run:{font:'Arial',size:21}}}},sections:[{properties:{page:{size:{width:12240,height:15840},margin:{top:1200,bottom:1000,left:1200,right:1200}}},children:kids}]});
Packer.toBuffer(doc).then(b=>fs.writeFileSync(out,b));
