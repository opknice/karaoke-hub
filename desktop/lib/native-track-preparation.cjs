class NativeTrackPreparation{
  constructor(controller){this.controller=controller;this.current=null;}
  async prepare(track,id){
    if(typeof id!=='string'||id.length<1||id.length>128)return{ok:false,error:'Invalid preparation request'};
    const current={id,track:{...track},stopSerial:this.controller.userStopSerial??0};this.current=current;
    const result=await this.controller.command('PREPARE_PLAYER_TRACK',track);
    return this.current===current&&!result.cancelled&&(this.controller.userStopSerial??0)===current.stopSerial?result:{ok:true,cancelled:true};
  }
  cancel(id){if(!this.current||this.current.id!==id)return false;this.current=null;void this.controller.disconnect();return true;}
  ready(track){if(this.current?.track.youtubeVideoId===track.youtubeVideoId&&this.current.track.queueItemId===track.queueItemId)this.current=null;}
}
module.exports={NativeTrackPreparation};
