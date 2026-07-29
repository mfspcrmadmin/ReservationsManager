string standalone.blueprint_getBlueprintTransitions(String transitionId)
{
res = Map();
res.put("error",false);
res.put("message","");
res.put("transition",Map());
res.put("raw_response",Map());
try 
{
	transitionId = ifnull(transitionId,"").toString().trim();
	if(transitionId == "")
	{
		res.put("error",true);
		res.put("message","transitionId is empty.");
		return res.toString();
	}
	url = "https://www.zohoapis.eu/crm/v8/settings/blueprints/transitions?ids=" + transitionId;
	resp = invokeurl
	[
		url :url
		type :GET
		connection:"crm_oauth_connection"
	];
	res.put("raw_response",resp);
	if(resp.containKey("transitions"))
	{
		transitions = resp.get("transitions");
		if(transitions.size() > 0)
		{
			res.put("transition",transitions.get(0));
			res.put("message","Blueprint transition retrieved successfully.");
		}
		else
		{
			res.put("error",true);
			res.put("message","Transition not found.");
		}
	}
	else
	{
		res.put("error",true);
		res.put("message","No transitions key found in response.");
	}
}
catch (e)
{
	res.put("error",true);
	res.put("message","Error retrieving blueprint transition: " + e.toString());
}
return res;
}