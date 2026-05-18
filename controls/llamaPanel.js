import { buyMerchantItem, getMerchantItemMeta } from '../characters/merchant.js';

let overlay; let panel;

const create = (tag, cls, txt='') => { const e=document.createElement(tag); if(cls) e.className=cls; if(txt) e.textContent=txt; return e; };

const getManager = () => window.friendlyNpcManager;

function getLlamaInventory(){ return getManager()?.getLlamaInventory?.(getManager()?.getLlamaFriendly?.()) || {}; }

async function sellToLlama(itemId){
  const app=window.appState; const inv=app?.getInventory?.()||{}; const entry=inv[itemId]; if(!entry?.count) return false;
  const price=Math.max(1, Math.floor((getMerchantItemMeta(itemId).price||2)/2));
  const coins=getManager()?.getLlamaCoins?.()||0; if(coins<price) return false;
  app?.removeFromInventory?.(itemId,1); getManager()?.adjustLlamaCoins?.(-price);
  const llama = getManager()?.getLlamaFriendly?.();
  if (llama?.model?.userData) llama.model.userData.llamaInventory = { ...getLlamaInventory(), [itemId]: { count: ((getLlamaInventory()[itemId]?.count)||0)+1, type: '' } };
  getManager()?.pushLlamaDialogueHistory?.({ type:'trade', text:`Player sold ${itemId} for ${price} coins.` });
  return true;
}

function render(){
  panel.innerHTML=''; const title=create('h2','',`Llama Trade (coins: ${getManager()?.getLlamaCoins?.()||0})`); panel.append(title);
  const inv=getLlamaInventory(); const list=create('div','inventory-grid');
  Object.entries(inv).forEach(([id,e])=>{ const b=create('button','inventory-tile',`${id} x${e.count}`); list.append(b); });
  panel.append(list);
  const pInv=window.appState?.getInventory?.()||{}; const sell=create('div','');
  Object.entries(pInv).filter(([,e])=>(e?.count||0)>0).slice(0,20).forEach(([id,e])=>{ const btn=create('button','',`Sell ${id} (${e.count})`); btn.onclick=async()=>{ await sellToLlama(id); render();}; sell.append(btn);});
  panel.append(sell);
}

export function openLlamaTradePanel(){
  overlay=document.getElementById('merchant-overlay'); panel=document.getElementById('merchant-panel'); if(!overlay||!panel) return;
  overlay.style.display='flex'; overlay.setAttribute('aria-hidden','false'); render();
}
