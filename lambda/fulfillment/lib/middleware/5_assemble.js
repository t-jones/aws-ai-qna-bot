var Promise=require('bluebird')
var lex=require('./lex')
var alexa=require('./alexa')
var _=require('lodash')
var util=require('./util')

function sms_hint(req,res) {
    var hint = "";
    if (_.get(req,"_event.requestAttributes.x-amz-lex:channel-type") == "Twilio-SMS") {
        if (_.get(req,"_settings.SMS_HINT_REMINDER_ENABLE")) {
            var interval_hrs = parseInt(_.get(req,'_settings.SMS_HINT_REMINDER_INTERVAL_HRS','24'));
            var hint_message = _.get(req,'_settings.SMS_HINT_REMINDER',"");
            var hours = req._userInfo.TimeSinceLastInteraction / 36e5;
            if (hours >= interval_hrs) {
                hint = hint_message;
                console.log("Appending hint to SMS answer: ", hint);
            }
        }
    }
    return hint;
}

function split_message(message) {
    message=message.replace(/\n/g," ") ;
    var parts = message.split(/[\.\?\!](.+)/,2) ; //split on first of these sentence terminators - '.?!'
    if (parts[1] == undefined) {
        parts[1]="";
    }
    return parts;
}

function connect_response(req, res) {
    if (req._clientType == "LEX.AmazonConnect.Voice") {
        if (_.get(req,"_settings.CONNECT_ENABLE_VOICE_RESPONSE_INTERRUPT")) {
            console.log("CONNECT_ENABLE_VOICE_RESPONSE_INTERRUPT is true. splitting response.")
            // split multi sentence responses.. First sentence stays in response, remaining sentences get prepended to next prompt session attribute.
            let nextPromptVarName = _.get(req,"_settings.CONNECT_NEXT_PROMPT_VARNAME",'nextPrompt') ;
            let message = res.message ;
            let prompt = _.get(res.session,nextPromptVarName,"").replace(/<speak>|<\/speak>/g, "") ;
            if (res.type == "PlainText") {
                // process plain text
                let a = split_message(message) ; //split on first period
                res.message = a[0];
                _.set(res.session,nextPromptVarName,a[1] + " " + prompt);
            } else if (res.type == "SSML") {
                // process SSML
                // strip <speak> tags
                message = message.replace(/<speak>|<\/speak>/g, "");
                let a = split_message(message) ;
                res.message = "<speak>" + a[0] + "</speak>" ;
                _.set(res.session,nextPromptVarName, "<speak>" + a[1] + " " + prompt + "</speak>");
            }
            console.log("Response message:", res.message);
            console.log("Reponse session var:", nextPromptVarName, ":", _.get(res.session,nextPromptVarName)) ;
        }
    }
    return res ;
}

function resetAttributes(req,res) {
    // Kendra attributes
    let previous;
    let prevQid;
    let kendraResponsibleQid;
    previous = _.get(req._event.sessionAttributes,"previous");
    if (previous) {
        let obj = JSON.parse(previous);
        prevQid = obj.qid;
    }
    kendraResponsibleQid = _.get(res.session,"qnabotcontext.kendra.kendraResponsibleQid");
    if ( (res.result === undefined || res.result.qid === undefined) || ( kendraResponsibleQid && (res.result.qid !== kendraResponsibleQid))) {
        // remove any prior session attributes for kendra as they are no longer valid
        _.unset(res,"session.qnabotcontext.kendra.kendraQueryId") ;
        _.unset(res,"session.qnabotcontext.kendra.kendraIndexId") ;
        _.unset(res,"session.qnabotcontext.kendra.kendraResultId") ;
        _.unset(res,"session.qnabotcontext.kendra.kendraResponsibleQid") ;
    }
}

module.exports=async function assemble(req,res){
    if(process.env.LAMBDA_LOG){
        await util.invokeLambda({
            FunctionName:process.env.LAMBDA_LOG,
            InvocationType:"Event",
            req,res
        })
    }

    if(process.env.LAMBDA_RESPONSE){
        var result=await util.invokeLambda({
            FunctionName:process.env.LAMBDA_RESPONSE,
            InvocationType:"RequestResponse",
            Payload:JSON.stringify(res)
        })

        _.merge(res,result)
    }
    
    // append hint to SMS message (if it's been a while since user last interacted)
    res.message += sms_hint(req,res);
    
    // enable interruptable bot response for Connect
    res = connect_response(req,res);

    
    res.session=_.mapValues(
        _.get(res,'session',{}),
        x=>_.isString(x) ? x : JSON.stringify(x)
    )

    resetAttributes(req,res);

    switch(req._type){
        case 'LEX':
            res.out=lex.assemble(req,res)
            break;
        case 'ALEXA':
            res.out=alexa.assemble(req,res)
            break;
    }

    return {req,res}
}
