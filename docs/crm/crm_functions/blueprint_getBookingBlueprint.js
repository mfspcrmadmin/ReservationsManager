string standalone.blueprint_getBookingBlueprint(String bookingId,String moduleApiName)
{
res = Map();
res.put("error",false);
res.put("message","");
res.put("module_api_name","");
res.put("record_id","");
res.put("blueprint",Map());
res.put("process_info",Map());
res.put("transitions",List());
res.put("raw_response",Map());
try 
{
	bookingId = ifnull(bookingId,"").toString().trim();
	moduleApiName = ifnull(moduleApiName,"Deals").toString().trim();
	if(bookingId == "")
	{
		res.put("error",true);
		res.put("message","bookingId is empty.");
		return res.toString();
	}
	if(moduleApiName == "")
	{
		moduleApiName = "Deals";
	}
	url = "https://www.zohoapis.eu/crm/v8/" + moduleApiName + "/" + bookingId + "/actions/blueprint";
	resp = invokeurl
	[
		url :url
		type :GET
		connection:"crm_oauth_connection"
	];
	res.put("module_api_name",moduleApiName);
	res.put("record_id",bookingId);
	res.put("raw_response",resp);
	if(resp.containKey("blueprint"))
	{
		blueprintData = resp.get("blueprint");
		if(blueprintData != null)
		{
			res.put("blueprint",blueprintData);
			processInfo = ifnull(blueprintData.get("process_info"),Map());
			transitions = ifnull(blueprintData.get("transitions"),List());
			res.put("process_info",processInfo);
			res.put("transitions",transitions);
			res.put("message","Booking blueprint retrieved successfully.");
		}
		else
		{
			res.put("error",true);
			res.put("message","Blueprint payload is empty.");
		}
	}
	else
	{
		res.put("error",true);
		res.put("message","No blueprint key found in response.");
	}
}
catch (e)
{
	res.put("error",true);
	res.put("message","Error retrieving booking blueprint: " + e.toString());
}
return res.toString();
}
