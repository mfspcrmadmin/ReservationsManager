string standalone.blueprint_getBlueprint(String blueprintId)
{
res = Map();
res.put("error",false);
res.put("message","");
res.put("blueprint",Map());
res.put("raw_response",Map());
try 
{
	blueprintId = ifnull(blueprintId,"").toString().trim();
	if(blueprintId == "")
	{
		res.put("error",true);
		res.put("message","blueprintId is empty.");
		return res.toString();
	}
	url = "https://www.zohoapis.eu/crm/v8/settings/blueprints/" + blueprintId;
	resp = invokeurl
	[
		url :url
		type :GET
		connection:"crm_oauth_connection"
	];
	res.put("raw_response",resp);
	if(resp.containKey("blueprints"))
	{
		blueprints = resp.get("blueprints");
		if(blueprints.size() > 0)
		{
			res.put("blueprint",blueprints.get(0));
			res.put("message","Blueprint retrieved successfully.");
		}
		else
		{
			res.put("error",true);
			res.put("message","Blueprint not found.");
		}
	}
	else
	{
		res.put("error",true);
		res.put("message","No blueprints key found in response.");
	}
}
catch (e)
{
	res.put("error",true);
	res.put("message","Error retrieving blueprint: " + e.toString());
}
return res.toString();
}