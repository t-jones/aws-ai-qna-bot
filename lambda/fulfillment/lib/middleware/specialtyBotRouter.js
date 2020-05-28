/**
 *
 * Specialty Bot Router. Given the name of a bot, Call Lex bot using 'live' alias and pass input text.
 * Handle response from Lex Bot and update session attributes as needed.
 */
const _=require('lodash');
const AWS = require('aws-sdk');
const multilanguage = require('./multilanguage.js');

function getBotUserId(req) {
    let tempBotUserID = _.get(req, "_userInfo.UserId", "nouser");
    tempBotUserID = tempBotUserID.substring(0, 100); // Lex has max userId length of 100
    return tempBotUserID;
}

async function lambdaClientRequester(name, req) {
    const lambda = new AWS.Lambda();
    const payload = {
        req: {
            request: "message",
            inputText: _.get(req, "question"),
            sessionAttributes: _.get(req, "sessionAttributes.specialtySessionAttributes", {}),
            userId: getBotUserId(req)
        }
    }
    const result = await lambda.invoke({
        FunctionName: name,
        InvocationType: "RequestResponse",
        Payload: JSON.stringify(payload)
    }).promise();
    return result;
}

/**
 * Call postText and use promise to return data response.
 * @param lexClient
 * @param params
 * @returns {*}
 */
function lexClientRequester(lexClient,params) {
    return new Promise(function(resolve, reject) {
        lexClient.postText(params, function(err, data) {
            if (err) {
                console.log(err, err.stack);
                reject('Lex client request error:' + err);
            }
            else {
                console.log("Lex client response:" + JSON.stringify(data, null, 2));
                resolve(data);
            }
        });
    });
}

/**
 * Setup call to Lex including user ID, input text, botName, botAlis. It is an async function and
 * will return the response form Lex.
 * @param req
 * @param res
 * @param botName
 * @param botAlias
 * @returns {Promise<*>}
 */
async function handleRequest(req, res, botName, botAlias) {
    if (botName.toLowerCase().startsWith("lambda::")) {
        // target bot is a Lambda Function
        const lambdaName = botName.split("::")[1];
        console.log("Calling Lambda:", lambdaName);
        let response = await lambdaClientRequester(lambdaName, req);
        console.log("lambda response: " + JSON.stringify(response,null,2));
        return response;
    } else {
        function mapFromSimpleName(botName) {
            const bName = process.env[botName];
            return bName ? bName : botName;
        }

        let tempBotUserID = _.get(req, "_userInfo.UserId", "nouser");
        tempBotUserID = tempBotUserID.substring(0, 100); // Lex has max userId length of 100
        const lexClient = new AWS.LexRuntime({apiVersion: '2016-11-28'});
        const params = {
            botAlias: botAlias,
            botName: mapFromSimpleName(botName),
            inputText: _.get(req, "question"),
            sessionAttributes: _.get(req, "sessionAttributes.specialtySessionAttributes", {}),
            userId: getBotUserId(req),
        };
        console.log("Lex parameters: " + JSON.stringify(params));
        const response = await lexClientRequester(lexClient, params);
        return response;
    }
};

function endUseOfSpecialtyBot(req, res, welcomeBackMessage) {
    delete res.session.specialtyBot;
    delete res.session.specialtyBotName;
    delete res.session.specialtyBotAlias;
    delete res.session.specialtySessionAttributes;

    if (welcomeBackMessage) {
        let plaintextResp = welcomeBackMessage;
        let htmlResp = `<i> ${welcomeBackMessage} </i>`;
        _.set(res, "message", plaintextResp);
        let altMessages = {
            'html': htmlResp
        };
        _.set(res.session, "appContext.altMessages", altMessages);
    }

    const resp = {};
    resp.req = req;
    resp.res = res;
    return resp;
}

/**
 * Main processing logic to handle request from 3_query.js and process response from Lex. Handles
 * dialogState response from Lex.
 * @param req
 * @param res
 * @param hook
 * @returns {Promise<{}>}
 */
async function processResponse(req, res, hook, alias) {
    console.log('specialtyBotRouter request: ' + JSON.stringify(req, null, 2));
    console.log('specialtyBotRouter response: ' + JSON.stringify(res, null, 2));
    const welcomeBackMessage = _.get(req._settings, 'BOT_ROUTER_WELCOME_BACK_MSG', 'Welcome back to QnABot.');
    const exitResponseDefault = _.get(req._settings, 'BOT_ROUTER_EXIT_MSGS', 'exit,quit,goodbye,leave');
    let exitResponses = exitResponseDefault.split(',');
    exitResponses.map(entry => entry.trim());
    let currentUtterance = req.question.toLowerCase();
    console.log(`current utterance: ${currentUtterance}`);
    console.log('exit responses are: ' + JSON.stringify(exitResponses,null,2));
    if (_.indexOf(exitResponses, currentUtterance)>=0) {
        console.log('user provided exit response given');
        let resp = endUseOfSpecialtyBot(req, res, welcomeBackMessage);
        resp.res = await multilanguage.translate_res(resp.req, resp.res);
        console.log("returning resp for user requested exit: " + JSON.stringify(resp,null,2));
        return resp;
    } else {
        let botResp = await handleRequest(req, res, hook, alias);
        console.log("specialty botResp: " + JSON.stringify(botResp, null, 2));
        if (botResp.message) {
            let ssmlMessage = undefined;
            if (botResp.sessionAttributes && botResp.sessionAttributes.appContext) {
                const appContext = JSON.parse(botResp.sessionAttributes.appContext);
                // if alt.messsages contains SSML tags setup to return ssmlMessage
                if (appContext.altMessages.ssml && appContext.altMessages.ssml.includes("<speak>")) {
                    ssmlMessage = appContext.altMessages.ssml;
                }
                _.set(res.session, "appContext.altMessages", appContext.altMessages);
            }
            _.set(res.session, "specialtySessionAttributes", botResp.sessionAttributes);
            _.set(res, "message", botResp.message);
            _.set(res, "plainMessage", botResp.message);
            _.set(res, "messageFormat", botResp.messageFormat);

            if (ssmlMessage && req._preferredResponseType === "SSML") {
                res.type = "SSML";
                res.message = ssmlMessage;
            }
            if (botResp.sessionAttributes.QNABOT_END_ROUTING) {
                console.log("specialtyBot requested exit");
                let resp = endUseOfSpecialtyBot(req, res, undefined);
                resp.res = await multilanguage.translate_res(resp.req, resp.res);
                return resp;
            }
        }

        // autotranslate res fields
        res = await multilanguage.translate_res(req, res);

        const resp = {};
        resp.req = req;
        resp.res = res;
        return resp;
    }
}

exports.routeRequest=processResponse;