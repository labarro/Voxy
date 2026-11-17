import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deploymentConfig} from '../scripts/prepare-deploy.mjs';

const base={vars:{VOXY_DEPLOYMENT_ENABLED:'true',VOXY_RELAY_ENABLED:'true'},observability:{enabled:true}};
const valid={accountId:'a'.repeat(32),hostname:'signal.voxy.example',freePlanConfirmed:true};
test('deployment preparation never enables endpoints, relay, previews or logging',()=>{
  const config=deploymentConfig(base,valid);
  assert.equal(config.account_id,valid.accountId);
  assert.deepEqual(config.routes,[{pattern:valid.hostname,custom_domain:true}]);
  assert.equal(config.vars.VOXY_DEPLOYMENT_ENABLED,'false');
  assert.equal(config.vars.VOXY_RELAY_ENABLED,'false');
  assert.equal(config.workers_dev,false);
  assert.equal(config.preview_urls,false);
  assert.equal(config.observability.enabled,false);
  for(const override of [{freePlanConfirmed:false},{accountId:'placeholder'},{hostname:'https://secret@signal.example/path'},{hostname:'localhost'},{hostname:'bad..example'}]) {
    assert.throws(()=>deploymentConfig(base,{...valid,...override}));
  }
});
