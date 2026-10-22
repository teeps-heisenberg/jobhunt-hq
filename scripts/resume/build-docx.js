const fs=require('fs');
const {Document,Packer,Paragraph,TextRun,Tab,TabStopType,AlignmentType,BorderStyle,LevelFormat}=require('docx');
const d=JSON.parse(fs.readFileSync(process.argv[2]));
const out=process.argv[3];
const F='Arial', S=21;               // 10.5pt body
const NAVY='1F3864';
const W=12240, M=864, CW=W-2*M;      // Letter, 0.6in side margins
const LINE=254;                      // 1.1 line spacing
const run=(t,o={})=>new TextRun({text:t,font:F,size:o.size||S,bold:o.bold,italics:o.italics,color:o.color});
const P=(children,o={})=>new Paragraph({children,spacing:{line:LINE,before:o.before||0,after:o.after==null?40:o.after},alignment:o.align,keepNext:o.keepNext,tabStops:o.tabs});
const H=t=>new Paragraph({spacing:{line:LINE,before:150,after:40},keepNext:true,
  border:{bottom:{style:BorderStyle.SINGLE,size:8,color:NAVY,space:2}},
  children:[run(t.toUpperCase(),{bold:true,size:23,color:NAVY})]});
const bullet=(children,after=20)=>new Paragraph({numbering:{reference:'b',level:0},spacing:{line:LINE,after},children});
const kids=[];
// Header
kids.push(P([run(d.name,{bold:true,size:36,color:NAVY})],{align:AlignmentType.CENTER,after:20}));
kids.push(P([run(d.title,{bold:true,size:23})],{align:AlignmentType.CENTER,after:40}));
d.contact.forEach(c=>kids.push(P([run(c,{size:19})],{align:AlignmentType.CENTER,after:0})));
// Summary
kids.push(H('Professional Summary'));
kids.push(P([run(d.summary)],{after:0}));
// Skills
kids.push(H('Technical Skills'));
d.skills.forEach(([k,v])=>kids.push(P([run(k+':  ',{bold:true}),run(v)],{after:30})));
// Experience
kids.push(H('Professional Experience'));
d.experience.forEach((e,i)=>{
  kids.push(new Paragraph({keepNext:true,spacing:{line:LINE,before:i?120:40,after:0},
    tabStops:[{type:TabStopType.RIGHT,position:CW}],
    children:[run(e.role,{bold:true}),run('  |  '+e.company,{bold:true}),new TextRun({children:[new Tab()],font:F,size:S}),run(e.dates,{bold:true})]}));
  kids.push(P([run(e.location,{italics:true,color:'444444'})],{keepNext:true,after:40}));
  e.bullets.forEach(b=>kids.push(bullet([run(b)])));
});
// Projects
kids.push(H('Selected Projects'));
d.projects.forEach(p=>kids.push(bullet([run(p.name,{bold:true}),run(': '+p.desc),run('  ('+p.tech+')',{italics:true,color:'444444'})],50)));
// Education
kids.push(H('Education'));
d.education.forEach(([deg,uni,gpa,yr])=>{
  kids.push(new Paragraph({spacing:{line:LINE,after:0},tabStops:[{type:TabStopType.RIGHT,position:CW}],
    children:[run(deg,{bold:true}),run('  |  '+uni),new TextRun({children:[new Tab()],font:F,size:S}),run(yr,{bold:true})]}));
  kids.push(P([run(gpa,{italics:true,color:'444444'})],{after:0}));
});
// Certifications
kids.push(H('Certifications'));
d.certifications.forEach(c=>kids.push(bullet([run(c)])));
// Additional
if(d.additional&&d.additional.length){kids.push(H('Additional Information'));d.additional.forEach(c=>kids.push(bullet([run(c)])));}

const doc=new Document({creator:d.name,title:d.name+' Resume',
 styles:{default:{document:{run:{font:F,size:S}}}},
 numbering:{config:[{reference:'b',levels:[{level:0,format:LevelFormat.BULLET,text:'•',alignment:AlignmentType.LEFT,style:{paragraph:{indent:{left:340,hanging:230}}}}]}]},
 sections:[{properties:{page:{size:{width:W,height:15840},margin:{top:640,bottom:560,left:M,right:M}}},children:kids}]});
Packer.toBuffer(doc).then(b=>{fs.writeFileSync(out,b);console.log('wrote',out)});
