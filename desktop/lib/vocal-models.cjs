const profiles=require('../vocal/models.json');
for(const profile of Object.values(profiles))Object.freeze(profile);
Object.freeze(profiles);
const VOCAL_MODEL_IDS=Object.freeze(Object.keys(profiles));
function getVocalModel(id='fast') {
  if(typeof id!=='string'||!Object.hasOwn(profiles,id))throw new TypeError('Unknown vocal model profile');
  return profiles[id];
}
module.exports={getVocalModel,VOCAL_MODEL_IDS};
