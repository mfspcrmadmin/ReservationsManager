const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../app/js/booking-controller.js'),'utf8');
const code=source.slice(source.indexOf('const studioChangedBookings ='),source.indexOf('const AXUS_ITINERARY_SYNC_ATTEMPTS'));
function fixture(){
 let callbacks;const state={selectedBookingId:'34',bookingWorkspaceRequestId:1,selectedBooking:{id:'34',Deal_Name:'Trip'},bookings:[{id:'34'}],steps:[{id:'12',Long_Description:'Old'}],services:[{id:'56',Product_Description:'Old service'}],selectedStepId:'12',selectedServiceId:'56',serviceFilters:{keep:true}};
 const c=vm.createContext({state,elements:{},MODULES:{bookings:'Deals'},createBookingDocumentsController:(e,s,d)=>{callbacks=d;return {};},cacheBookingLookup:(s,r)=>{s.cached=r;},createSelectionSnapshot:()=>({step:'12',service:'56'}),indexSteps:(s,rows)=>s.stepIndex=Object.fromEntries(rows.map(r=>[r.id,r])),restoreSelectionSnapshot:()=>{state.selectedStep=state.stepIndex['12'];state.selectedService=state.services.find(r=>r.id==='56');},applyServiceFilter:()=>{},renderBookingSummary:()=>{},renderBookingBrowserPanel:()=>{},renderBookingWorkspace:()=>{},setError:(e,message)=>state.error=message,crmGetRecord:async()=>({id:'34',Deal_Name:'Refreshed trip'}),loadBookingServicesForBooking:async()=>[{id:'56',Product_Description:'Workflow service'}],loadBookingStepsForBooking:async()=>[{id:'12',Long_Description:'Refreshed step'}]});
 vm.runInContext(code,c);return {state,c,callbacks};
}
test('successful Studio edit updates workspace state immediately and close refreshes related records without losing selection',async()=>{
 const {state,c,callbacks}=fixture();callbacks.onCRMUpdated({booking_id:'34',module:'Booking_Steps',raw:{id:'12',Long_Description:'Saved'}});
 assert.equal(state.selectedStep.Long_Description,'Saved');
 await c.refreshWorkspaceAfterStudio();
 assert.equal(state.selectedBooking.Deal_Name,'Refreshed trip');assert.equal(state.selectedStep.Long_Description,'Refreshed step');assert.equal(state.selectedService.Product_Description,'Workflow service');assert.equal(state.serviceFilters.keep,true);
});
test('a late workspace refresh cannot overwrite a different booking',async()=>{
 const {state,c,callbacks}=fixture();let resolve;c.crmGetRecord=()=>new Promise(r=>resolve=r);callbacks.onCRMUpdated({booking_id:'34'});
 const pending=c.refreshWorkspaceAfterStudio();state.selectedBookingId='99';state.selectedBooking={id:'99'};resolve({id:'34'});await pending;
 assert.equal(state.selectedBooking.id,'99');assert.equal(state.steps[0].Long_Description,'Old');
});
test('an older refresh cannot overwrite a newer Studio save',async()=>{
 const {state,c,callbacks}=fixture();let resolve;c.crmGetRecord=()=>new Promise(r=>resolve=r);callbacks.onCRMUpdated({booking_id:'34'});
 const pending=c.refreshWorkspaceAfterStudio();callbacks.onCRMUpdated({booking_id:'34',module:'Booking_Steps',raw:{id:'12',Long_Description:'Newest'}});resolve({id:'34'});await pending;
 assert.equal(state.selectedStep.Long_Description,'Newest');
});
test('refresh failure reports that CRM may already be updated',async()=>{
 const {state,c,callbacks}=fixture();c.crmGetRecord=async()=>{throw new Error('Offline');};callbacks.onCRMUpdated({booking_id:'34'});await c.refreshWorkspaceAfterStudio();assert.match(state.error,/workspace could not refresh/);
});
