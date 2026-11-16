// Presentation geometry only. Every cable endpoint is assigned a distinct
// attachment on the corresponding side of the device, INCLUDING connections
// to different neighbours. The socket/NIC indices are never modified here.
const LEFT=-1, RIGHT=1;
const FACE_HALF_X=38, FACE_HALF_Y=29;
const NODE_CX=49, NODE_CY=37;

export function deviceCenter(node){return {x:node.x+NODE_CX,y:node.y+NODE_CY};}
export function attachmentSide(node,other){
  const a=deviceCenter(node),b=deviceCenter(other),dx=b.x-a.x,dy=b.y-a.y;
  // Normalise for the dimensions of a device icon so diagonal connections
  // attach to the most appropriate edge instead of all using its right side.
  return Math.abs(dx)/49>=Math.abs(dy)/47?(dx>=0?'right':'left'):(dy>=0?'bottom':'top');
}
export function anchorFor(node,target){
  const c=deviceCenter(node),dx=target.x-c.x,dy=target.y-c.y;
  if(Math.abs(dx)/49>=Math.abs(dy)/47)return {x:c.x+(dx>=0?50:-50),y:c.y};
  return {x:c.x,y:c.y+(dy>=0?68:-36)};
}
function sideAnchor(node,side,slot,total){
  const c=deviceCenter(node);
  const wide=side==='top'||side==='bottom';
  const half=wide?FACE_HALF_X:FACE_HALF_Y;
  const spacing=total>1?Math.min(15,(2*half)/(total-1)):0;
  const offset=(slot-(total-1)/2)*spacing;
  switch(side){
    case 'left':return {x:c.x-50,y:c.y+offset};
    case 'right':return {x:c.x+50,y:c.y+offset};
    case 'top':return {x:c.x+offset,y:c.y-36};
    default:return {x:c.x+offset,y:c.y+68}; // below the device caption
  }
}
export function layoutParallelCables(lab){
  const nodes=new Map((lab.nodes||[]).map(n=>[n.id,n]));
  const records=new Map(),groups=new Map();
  for(const link of lab.links||[]){
    const a=nodes.get(link.a),b=nodes.get(link.b);
    if(!a||!b)continue;
    const first={node:a,other:b,side:attachmentSide(a,b),port:link.aPort,linkId:link.id,end:'A'};
    const second={node:b,other:a,side:attachmentSide(b,a),port:link.bPort,linkId:link.id,end:'B'};
    records.set(link.id,{first,second});
    for(const endpoint of [first,second]){
      const key=`${endpoint.node.id}:${endpoint.side}`;
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(endpoint);
    }
  }
  // Sort by the projected position of the neighbour, then interface index.
  // Grouping by all links touching an edge avoids repeated attachment points
  // when a switch has cables to many different devices.
  for(const endpoints of groups.values()){
    const vertical=endpoints[0].side==='left'||endpoints[0].side==='right';
    endpoints.sort((a,b)=>{
      const pa=deviceCenter(a.other),pb=deviceCenter(b.other);
      const projection=(vertical?pa.y-pb.y:pa.x-pb.x);
      return projection||a.port-b.port||String(a.linkId).localeCompare(String(b.linkId));
    });
    endpoints.forEach((end,i)=>{end.point=sideAnchor(end.node,end.side,i,endpoints.length);end.slot=i;end.sideCount=endpoints.length;});
  }
  const result=new Map();
  for(const [id,{first,second}] of records){
    const A=first.point,B=second.point;
    result.set(id,{A,B,slot:first.slot,total:first.sideCount,sideA:first.side,sideB:second.side});
  }
  return result;
}

function badgeBox(x,y,width,height){return {left:x-width/2,right:x+width/2,top:y-height/2,bottom:y+height/2};}
function intersectArea(a,b){return Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));}

// Port labels are placed as an entire topology, not one cable at a time.
// Prefer the first few pixels outside each device, but move a badge along or
// across the cable when another port badge or appliance would cover it.
export function layoutPortBadges(lab,links,portName){
  const nodes=new Map((lab.nodes||[]).map(n=>[n.id,n]));
  const occupied=[];
  const nodeBoxes=(lab.nodes||[]).map(n=>({left:n.x-3,right:n.x+101,top:n.y-4,bottom:n.y+105}));
  const result=new Map();
  const items=[];
  for(const link of lab.links||[]){
    const geo=links.get(link.id),a=nodes.get(link.a),b=nodes.get(link.b);
    if(!geo||!a||!b)continue;
    items.push({id:link.id,end:'a',point:geo.A,other:geo.B,name:String(portName(a,link.aPort))});
    items.push({id:link.id,end:'b',point:geo.B,other:geo.A,name:String(portName(b,link.bPort))});
  }
  items.sort((a,b)=>a.id.localeCompare(b.id)||a.end.localeCompare(b.end));
  for(const item of items){
    const {point,other,name}=item,dx=other.x-point.x,dy=other.y-point.y;
    const len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len,nx=-uy,ny=ux;
    const width=Math.max(35,name.length*6.35+13),height=18;
    let chosen=null,bestScore=Infinity;
    const maxAlong=Math.max(20,Math.min(70,len*0.38));
    const alongs=[24,35,48,61,70].filter(t=>t<=maxAlong+10);
    if(!alongs.length)alongs.push(18);
    for(const along of alongs){
      for(const across of [0,-18,18,-32,32,-48,48]){
        const x=point.x+ux*along+nx*across,y=point.y+uy*along+ny*across;
        const box=badgeBox(x,y,width,height);
        const overlap=occupied.reduce((sum,o)=>sum+intersectArea(box,o)*30,0);
        const nodeOverlap=nodeBoxes.reduce((sum,o)=>sum+intersectArea(box,o)*20,0);
        const score=overlap+nodeOverlap+Math.abs(across)*.75+Math.abs(along-27)*.20;
        if(score<bestScore){bestScore=score;chosen={x,y,width,height};}
      }
    }
    occupied.push(badgeBox(chosen.x,chosen.y,width,height));
    const entry=result.get(item.id)||{};entry[item.end]=chosen;result.set(item.id,entry);
  }
  return result;
}
