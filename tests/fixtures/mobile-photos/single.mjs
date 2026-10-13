// Explicit bounded fixture subprocess for Playwright's CommonJS test loader.
import {generateImage,mainCase} from './generate.mjs';
const [name,...extra]=process.argv.slice(2);
if(extra.length||!['camera','compact'].includes(name))throw Error('Use single.mjs camera|compact');
const spec=name==='camera'?mainCase(0):{...mainCase(1),width:900,height:1200};
const bytes=await generateImage(spec);
if(bytes.length>20*1024*1024)throw Error('Fixture exceeds admission');
process.stdout.write(bytes);
