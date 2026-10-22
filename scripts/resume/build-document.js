const fs=require('fs');const {Document,Packer,Paragraph,TextRun,AlignmentType,HeadingLevel}=require('docx');
const [,,inp,out]=process.argv;const d=JSON.parse(fs.readFileSync(inp));
const run=(t,o={})=>new TextRun({text:t,font:'Arial',size:o.size||21,bold:o.bold,italics:o.italics,color:o.color});
const P=(t,o={})=>new Paragraph({spacing:{line:264,after:o.after??140,before:o.before??0},alignment:o.align,children:[run(t,o)]});
const kids=[];
kids.push(new Paragraph({spacing:{after:60},children:[run(d.title,{bold:true,size:30})]}));
if(d.subtitle) kids.push(P(d.subtitle,{italics:true,color:'555555',after:260}));
for(const s of d.sections){
  if(s.h) kids.push(new Paragraph({spacing:{before:220,after:80},children:[run(s.h,{bold:true,size:24,color:'1F3864'})]}));
  for(const p of s.p||[]){
    if(typeof p==='string') kids.push(P(p));
    else if(p.bullet) kids.push(new Paragraph({bullet:{level:0},spacing:{line:264,after:80},children:[run(p.bullet)]}));
    else if(p.kv) kids.push(new Paragraph({spacing:{line:264,after:60},children:[run(p.kv[0]+': ',{bold:true}),run(p.kv[1])]}));
  }
}
const doc=new Document({styles:{default:{document:{run:{font:'Arial',size:21}}}},sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:1100,bottom:1000,left:1200,right:1200}}},children:kids}]});
Packer.toBuffer(doc).then(b=>fs.writeFileSync(out,b));
