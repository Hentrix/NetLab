// Presentation descriptors only. QEMU NIC indices are unchanged; labels and
// nominal speeds do not reconfigure the emulated Ethernet adapter.
export const SPEEDS = [10,100,1000,10000,25000,40000,100000];
export function portCapacity(node) { return Number(node?.nicCount)||16; }
export function defaultSpeed(node) {
  switch(node?.nicModel){case 'rtl8139':return 100;case 'e1000':return 1000;case 'virtio-net-pci':return 10000;default:return 1000;}
}
export function portFamily(node,imageName='') {
  if(node?.portStyle && node.portStyle!=='auto')return node.portStyle;
  const hint=[node?.name,node?.icon,imageName].join(' ').toLowerCase();
  if(/mikrotik|routeros|chr/.test(hint))return 'ether';
  if(/huawei|ar1000|vrp|cloudengine|ne40e/.test(hint))return 'ge';
  if(/juniper|vsrx|vmx|vqfx/.test(hint))return 'jge';
  if(/ios.?on.?linux|\biol\b|\biou\b/.test(hint))return 'e';
  if(/cisco|iosv|csr1000|c8000|catalyst|\b2960\b|\b2950\b/.test(hint))return 'gi';
  return 'eth';
}
export function automaticPortName(family,index,speed) {
  switch(family){
    case 'ether':return `ether${index+1}`;
    case 'gi':case 'fa':{
      const prefix=speed<=100?'Fa':speed>=10000?'Te':'Gi';
      return `${prefix}0/${index}`;
    }
    case 'e': return `e0/${index}`;
    case 'ge':return `${speed<=100?'FE':speed>=10000?'10GE':'GE'}0/0/${index}`;
    case 'jge':return `${speed<=100?'fe':speed>=10000?'xe':'ge'}-0/0/${index}`;
    case 'ens':return `ens${index+3}`;
    default:return `eth${index}`;
  }
}
export function portInfo(node,index,imageName='') {
  const config=node?.ports?.[index]||{};
  const speed=Number(config.speedMbps)||defaultSpeed(node);
  return {index,name:config.name?.trim()||automaticPortName(portFamily(node,imageName),index,speed),speedMbps:speed,custom:!!config.name};
}
export function speedText(mbps){return mbps>=1000?`${mbps/1000} Gb/s`:`${mbps} Mb/s`;}
