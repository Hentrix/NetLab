// A fixed pair-order and distinct edge slots keep cables between the same
// two devices separate, independent of original A/B direction.
export function deviceCenter(n){return {x:n.x+49,y:n.y+37};}
export function anchorFor(n,target){
  const c=deviceCenter(n),dx=target.x-c.x,dy=target.y-c.y;
  if(Math.abs(dx)>Math.abs(dy))return {x:c.x+(dx>=0?37:-37),y:c.y};
  return {x:c.x,y:c.y+(dy>=0?26:-26)};
}
export function layoutParallelCables(lab){
  const nodes=new Map(lab.nodes.map(n=>[n.id,n]));
  const groups=new Map();
  for(const link of lab.links){
    if(!nodes.has(link.a)||!nodes.has(link.b))continue;
    const [first,second]=[link.a,link.b].sort();
    const key=first+':'+second;
    if(!groups.has(key))groups.set(key,{first,second,links:[]});
    groups.get(key).links.push(link);
  }
  const result=new Map();
  for(const {first,second,links} of groups.values()){
    // Endpoint order follows port indices so rearrangements remain stable.
    links.sort((a,b)=>{
      const ai=a.a===first?a.aPort:a.bPort,bi=b.a===first?b.aPort:b.bPort;
      const aj=a.a===second?a.aPort:a.bPort,bj=b.a===second?b.aPort:b.bPort;
      return ai-bi||aj-bj||a.id.localeCompare(b.id);
    });
    const a=nodes.get(first),b=nodes.get(second),ca=deviceCenter(a),cb=deviceCenter(b);
    const dx=cb.x-ca.x,dy=cb.y-ca.y;
    const horizontal=Math.abs(dx)>=Math.abs(dy);
    const sep=links.length>1?Math.min(19,54/(links.length-1)):0;
    links.forEach((link,i)=>{
      const offset=(i-(links.length-1)/2)*sep;
      const A=horizontal?{x:ca.x+(dx>=0?38:-38),y:ca.y+offset}:{x:ca.x+offset,y:ca.y+(dy>=0?27:-27)};
      const B=horizontal?{x:cb.x+(dx>=0?-38:38),y:cb.y+offset}:{x:cb.x+offset,y:cb.y+(dy>=0?-27:27)};
      result.set(link.id,link.a===first?{A,B,slot:i,total:links.length}:{A:B,B:A,slot:i,total:links.length});
    });
  }
  return result;
}
