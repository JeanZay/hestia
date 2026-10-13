export type CorpusCase = {id:string;group:string;index:number;width:number;height:number;quality:number;noise:number;orientation:number;lowContrast:boolean;color:boolean};
export function mainCase(index:number):CorpusCase;
export function generateImage(spec:CorpusCase):Promise<Buffer>;
export function vectorPdf(pages:number):Promise<Buffer>;
export const plan:{mainCount:number};
