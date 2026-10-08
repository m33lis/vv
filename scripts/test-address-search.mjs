// Run: node scripts/test-address-search.mjs "Vabaduse väljak 7 Tallinn"
const query=process.argv[2] || 'Vabaduse väljak 7 Tallinn';
const url=new URL('https://aks.geoportaal.ee/inaks/inaadress/gazetteer');
url.search=new URLSearchParams({address:query,results:'5',ihist:'0',appartment:'0'});
try {
  const response=await fetch(url,{signal:AbortSignal.timeout(15000)});
  console.log(`HTTP ${response.status} (${response.headers.get('content-type')})`);
  if(!response.ok) throw new Error('Address service returned an error');
  const data=await response.json();
  if(data.error) throw new Error('Provider error: '+data.error);
  if(!data.addresses && data.host) data.addresses=[];
  if(!Array.isArray(data.addresses)) throw new Error('Unexpected response: missing addresses');
  console.table(data.addresses.map(a=>({address:a.ipikkaadress,latitude:a.viitepunkt_b,longitude:a.viitepunkt_l})));
  console.log(`${data.addresses.length} matches. HTTPS certificate validation is enabled.`);
} catch(error) { console.error(error.message); process.exitCode=1; }

