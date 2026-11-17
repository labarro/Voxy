// Produces a disabled, local-only deployment configuration. Never calls Cloudflare.
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {resolve, dirname} from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
export function deploymentConfig(base, {accountId, hostname, freePlanConfirmed}) {
  if (freePlanConfirmed !== true) throw Error('Confirme a conta Workers/Durable Objects Free antes de preparar a configuração.');
  if (!/^[a-f0-9]{32}$/i.test(accountId ?? '')) throw Error('Account ID Cloudflare inválido.');
  if (typeof hostname !== 'string' || hostname.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(hostname)) throw Error('Informe somente o subdomínio DNS, sem URL, caminho ou credenciais.');
  return {
    ...base,
    main: resolve(root, 'src/worker.ts'),
    account_id: accountId,
    routes: [{pattern: hostname.toLowerCase(), custom_domain: true}],
    vars: {...base.vars, VOXY_DEPLOYMENT_ENABLED: 'false', VOXY_RELAY_ENABLED: 'false'},
    workers_dev: false,
    preview_urls: false,
    observability: {enabled: false},
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const flag = key => {const index=args.indexOf(key);return index<0?undefined:args[index+1];};
    const allowed = new Set(['--account-id', '--hostname', '--free-plan-confirmed']);
    for(let i=0;i<args.length;i++) {
      if(!allowed.has(args[i])) throw Error('Argumento desconhecido. Use --account-id ID --hostname DNS --free-plan-confirmed.');
      if(args[i] !== '--free-plan-confirmed') i++;
    }
    const base = JSON.parse(await readFile(resolve(root,'wrangler.jsonc'),'utf8'));
    const config = deploymentConfig(base, {
      accountId: flag('--account-id') ?? process.env.CLOUDFLARE_ACCOUNT_ID,
      hostname: flag('--hostname'),
      freePlanConfirmed: args.includes('--free-plan-confirmed'),
    });
    const output = resolve(root,'../../.local/signaling/wrangler.json');
    await mkdir(dirname(output),{recursive:true});
    await writeFile(output,JSON.stringify(config,null,2)+'\n',{mode:0o600});
    console.log('Configuração local preparada em .local/signaling/wrangler.json; implantação e relay permanecem desativados.');
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
