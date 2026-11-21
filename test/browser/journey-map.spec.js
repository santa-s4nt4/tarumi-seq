import { test, expect } from '@playwright/test';
async function seek(page,value) {await page.locator('#custom-seek').evaluate((e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));},value);}
async function centerError(page) {return page.evaluate(()=>{
  const panel=document.querySelector('.map-panel').getBoundingClientRect(), marker=document.querySelector('.current-marker').getBoundingClientRect();
  return Math.hypot(marker.x+marker.width/2-panel.x-panel.width/2,marker.y+marker.height/2-panel.y-panel.height/2);
});}
test('real terrain map centers the train, fixes view zooms, and does not oscillate in a tunnel',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/expression|layer|source|elevation/i.test(m.text()))errors.push(m.text());});
  await page.goto('/custom/?train=23&day=weekday');await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('.current-marker')).toBeVisible();
  await page.getByRole('button',{name:'進行方向',exact:true}).click();await expect(page.locator('#map')).toHaveAttribute('data-zoom','20');
  await expect.poll(()=>centerError(page)).toBeLessThan(6);
  await seek(page,500);await expect.poll(()=>centerError(page)).toBeLessThan(6);
  await page.getByRole('button',{name:'鳥瞰',exact:true}).click();await expect(page.locator('#map')).toHaveAttribute('data-zoom','19');
  await expect.poll(()=>centerError(page)).toBeLessThan(6);
  await page.getByRole('button',{name:'自動',exact:true}).click();
  // Between 高科 and 鍋原, within tunnel country. Keep the same paused point.
  await seek(page,740);await page.waitForTimeout(3500);
  const modes=[];for(let i=0;i<8;i++){modes.push(await page.locator('#map').getAttribute('data-camera'));await page.waitForTimeout(400);}
  expect(new Set(modes).size).toBe(1);await expect.poll(()=>centerError(page)).toBeLessThan(6);
  expect(errors).toEqual([]);await page.screenshot({path:'test-results/journey-terrain.png'});
});

test('moving position follows display frames without per-frame terrain scans',async({page})=>{
  await page.goto('/custom/?train=23&day=weekday');
  await expect(page.locator('.current-marker')).toBeVisible();await seek(page,600);
  await page.locator('#custom-play').click();
  const result=await page.evaluate(async()=>{
    const resource=performance.getEntriesByType('resource').map(e=>e.name).find(name=>name.includes('/deps/mapbox-gl.js'));
    const module=await import(resource), lib=module.default??module;
    const coordinates=new Set();let terrain=0,frames=0;
    const move=lib.Marker.prototype.setLngLat, sample=lib.Map.prototype.queryTerrainElevation;
    lib.Marker.prototype.setLngLat=function(value){if(this.getElement().classList.contains('current-marker'))coordinates.add(String(value));return move.call(this,value);};
    lib.Map.prototype.queryTerrainElevation=function(...args){terrain++;return sample.apply(this,args);};
    await new Promise(resolve=>{let start;function tick(now){start??=now;frames++;if(now-start<2000)requestAnimationFrame(tick);else resolve();}requestAnimationFrame(tick);});
    lib.Marker.prototype.setLngLat=move;lib.Map.prototype.queryTerrainElevation=sample;
    return {positions:coordinates.size,frames,terrain};
  });
  expect(result.positions).toBeGreaterThan(result.frames*.8);
  expect(result.terrain).toBeLessThan(3000);
});
