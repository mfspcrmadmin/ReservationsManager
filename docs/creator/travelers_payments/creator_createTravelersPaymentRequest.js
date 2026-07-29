map standalone.creator_createTravelersPaymentRequest(string requestBody)
{
	res = Map();
	try
	{
		if(requestBody == null || requestBody.trim() == "")
		{
			res.put("success",false);
			res.put("message","requestBody is empty");
			return res;
		}
		headers = Map();
		headers.put("Content-Type","application/json");
		creatorResponse = invokeurl
		[
			url :"https://www.zohoapis.eu/creator/custom/madeforspainandportugal/Create_Travelers_Payment_Request"
			type :POST
			parameters:requestBody
			headers:headers
			connection:"creator_oauth"
		];
		if(ifnull(creatorResponse.get("code"),0).toLong() != 3000)
		{
			res.put("success",false);
			res.put("message",ifnull(creatorResponse.get("message"),"Creator endpoint returned an error."));
			return res;
		}
		result = ifnull(creatorResponse.get("result"),"{}").toString().toMap();
		res.put("success",ifnull(result.get("success"),false));
		res.put("result",result);
		res.put("message",ifnull(result.get("message"),""));
	}
	catch(e)
	{
		res.put("success",false);
		res.put("message",e.toString());
	}
	return res;
}
