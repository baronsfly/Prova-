export function createSessionReader({
  cloudStoredSession,saveCloudSession,requestRefresh
}){
  async function refreshCloudSession(session){if(!session?.refresh_token)return null;const data=await requestRefresh(session.refresh_token);if(cloudStoredSession()?.refresh_token!==session.refresh_token)return cloudStoredSession();saveCloudSession(data);return data}
  let refreshInProgress;
  async function cloudSession(){
    const session=cloudStoredSession();
    if(!session)return null;
    if(session.access_token&&Number(session.expires_at)>Date.now()/1000+60)return session;
    const token=session.refresh_token;
    if(refreshInProgress?.token===token)return refreshInProgress.promise;
    const promise=refreshCloudSession(session).catch(error=>{
      if(cloudStoredSession()?.refresh_token!==token)return cloudStoredSession();
      if([400,401].includes(error.status)&&/refresh.token|invalid.grant|session.not.found/i.test(error.message)){saveCloudSession(null);return null}
      throw error;
    }).finally(()=>{if(refreshInProgress?.promise===promise)refreshInProgress=null});
    refreshInProgress={token,promise};return promise;
  }
  return {cloudSession};
}
