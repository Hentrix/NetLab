// Lightweight, dependency-free VT/ANSI screen for network-device CLI output.
// Interprets common cursor, erase, and SGR sequences; never inserts untrusted HTML.
const COLORS=['#111827','#dc6b6b','#74c991','#d8bf71','#80aee8','#bf91d9','#76cdd4','#d9e2ed'];
export const escapeTerminalHTML = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cloneStyle=s=>({fg:s.fg,bg:s.bg,bold:s.bold,underline:s.underline});
export class VTBuffer {
 constructor({cols=100,maxLines=2500}={}){this.cols=cols;this.maxLines=maxLines;this.reset();}
 reset(){this.lines=[[]];this.row=0;this.col=0;this.style={fg:null,bg:null,bold:false,underline:false};this.phase='text';this.csi='';this.osc='';this.saved=[0,0];}
 getLine(row){while(this.lines.length<=row)this.lines.push([]);return this.lines[row];}
 move(row,col){this.row=Math.max(0,Math.min(this.lines.length+120,row));this.col=Math.max(0,Math.min(500,col));this.getLine(this.row);}
 trim(){if(this.lines.length>this.maxLines){const extra=this.lines.length-this.maxLines;this.lines.splice(0,extra);this.row=Math.max(0,this.row-extra);this.saved[0]=Math.max(0,this.saved[0]-extra);}}
 put(char){if(this.col>=this.cols){this.col=0;this.row++;this.getLine(this.row);this.trim();}
  const line=this.getLine(this.row);while(line.length<this.col)line.push({c:' ',s:null});
  line[this.col++]={c:char,s:cloneStyle(this.style)};
 }
 eraseLine(mode){const line=this.getLine(this.row);
  if(mode===2){line.length=0;return;}
  if(mode===1){for(let i=0;i<=this.col&&i<line.length;i++)line[i]={c:' ',s:null};return;}
  line.splice(this.col);
 }
 eraseScreen(mode){if(mode===2||mode===3){this.lines=[[]];this.row=0;this.col=0;return;}
  if(mode===0){this.eraseLine(0);this.lines.splice(this.row+1);}else if(mode===1){for(let y=0;y<this.row;y++)this.lines[y]=[];this.eraseLine(1);}
 }
 setSGR(params){if(!params.length)params=[0];for(let i=0;i<params.length;i++){const n=params[i];
  if(n===0){this.style={fg:null,bg:null,bold:false,underline:false};continue;}
  if(n===1)this.style.bold=true;
  if(n===4)this.style.underline=true;
  if(n===22)this.style.bold=false;
  if(n===24)this.style.underline=false;
  if(n===39)this.style.fg=null;
  if(n===49)this.style.bg=null;
  if(n>=30&&n<=37)this.style.fg=COLORS[n-30];
  if(n>=40&&n<=47)this.style.bg=COLORS[n-40];
  if(n>=90&&n<=97)this.style.fg=COLORS[n-90];
  if(n>=100&&n<=107)this.style.bg=COLORS[n-100];
  if((n===38||n===48)&&params[i+1]===2&&i+4<params.length){const [r,g,b]=params.slice(i+2,i+5).map(x=>Math.max(0,Math.min(255,x)));this.style[n===38?'fg':'bg']=`rgb(${r},${g},${b})`;i+=4;}
  else if((n===38||n===48)&&params[i+1]===5&&i+2<params.length){const v=params[i+2];if(v<16){this.style[n===38?'fg':'bg']=COLORS[v%8];}else if(v>=232){const shade=8+Math.floor((v-232)*10);this.style[n===38?'fg':'bg']=`rgb(${shade},${shade},${shade})`;}else{const z=v-16;const channel=i=>[0,95,135,175,215,255][i];this.style[n===38?'fg':'bg']=`rgb(${channel(Math.floor(z/36))},${channel(Math.floor(z%36/6))},${channel(z%6)})`;}i+=2;}
 }}
 interpretCSI(end){const raw=this.csi.replace(/^\?/,''),params=raw===''?[]:raw.split(';').map(x=>Math.max(0,Number(x)||0));const a=params[0]||1;
  if(end==='m')return this.setSGR(params);
  if(end==='A')return this.move(this.row-a,this.col);
  if(end==='B')return this.move(this.row+a,this.col);
  if(end==='C')return this.move(this.row,this.col+a);
  if(end==='D')return this.move(this.row,this.col-a);
  if(end==='G')return this.move(this.row,a-1);
  if(end==='H'||end==='f')return this.move((params[0]||1)-1,(params[1]||1)-1);
  if(end==='K')return this.eraseLine(params[0]||0);
  if(end==='J')return this.eraseScreen(params[0]||0);
  if(end==='s')this.saved=[this.row,this.col];
  if(end==='u')this.move(...this.saved);
  if(end==='P'){const line=this.getLine(this.row);line.splice(this.col,a);}
  if(end==='@'){const line=this.getLine(this.row);line.splice(this.col,0,...Array.from({length:Math.min(80,a)},()=>({c:' ',s:null})));}
 }
 write(text){for(const char of text){
  if(this.phase==='osc'){if(char==='\x07'||char==='\x1b')this.phase='oscEnd';continue;}
  if(this.phase==='oscEnd'){this.phase='text';continue;}
  if(this.phase==='esc'){this.phase=char==='['?'csi':char===']'?'osc':'text';this.csi='';if(char==='7')this.saved=[this.row,this.col];if(char==='8')this.move(...this.saved);continue;}
  if(this.phase==='csi'){if(char>='@'&&char<='~'){this.interpretCSI(char);this.phase='text';this.csi='';}else if(this.csi.length<60)this.csi+=char;else this.phase='text';continue;}
  if(char==='\x1b'){this.phase='esc';continue;}
  if(char==='\r'){this.col=0;continue;}
  if(char==='\n'){this.row++;this.getLine(this.row);this.trim();continue;}
  if(char==='\b'||char==='\x7f'){this.col=Math.max(0,this.col-1);continue;}
  if(char==='\t'){const until=8-(this.col%8);for(let i=0;i<until;i++)this.put(' ');continue;}
  if(char>=' '&&char!=='\x7f')this.put(char);
 }}
 toText(){return this.lines.map(line=>line.map(cell=>cell.c).join('').replace(/\s+$/,'')).join('\n');}
 toHTML(){return this.lines.map((line,row)=>{
 const cells=[...line],cursorAt=row===this.row?this.col:-1;
 if(cursorAt>=0)while(cells.length<=cursorAt)cells.push({c:' ',s:null});
 if(!cells.length)return '<div class="terminal-line"> </div>';
 let out='',part='',last='';
 const flush=()=>{if(!part)return;out+=last?`<span style="${last}">${escapeTerminalHTML(part)}</span>`:escapeTerminalHTML(part);part='';};
 for(let i=0;i<cells.length;i++){
  const cell=cells[i],a=cell.s;let style='';
  if(a){if(a.fg)style+=`color:${a.fg};`;if(a.bg)style+=`background:${a.bg};`;if(a.bold)style+='font-weight:700;';if(a.underline)style+='text-decoration:underline;';}
  if(i===cursorAt){flush();out+=`<span class="terminal-caret">${escapeTerminalHTML(cell.c)}</span>`;last='';continue;}
  if(style!==last){flush();last=style;}part+=cell.c;
 }
 flush();return `<div class="terminal-line">${out||' '}</div>`;
 }).join('');}

}
