const Promise = require('bluebird')
const _ = require('lodash')
const AWS = require('aws-sdk');

async function get_userLanguages(inputText) {
    const params = {
        Text: inputText /* required */
    };
    const comprehendClient = new AWS.Comprehend();
    const languages = comprehendClient.detectDominantLanguage(params).promise();
    return languages;
}

async function get_translation(inputText, sourceLang, targetLang) {
    const params = {
        SourceLanguageCode: sourceLang, /* required */
        TargetLanguageCode: targetLang, /* required */
        Text: inputText, /* required */
    };
    console.log("get_translation:", targetLang, "InputText: ", inputText);
    if (targetLang === sourceLang) {
        console.log("get_translation: source and target are the same, translation not required.");
        const res = {};
        res.TranslatedText = inputText;
        return res;
    }

    const translateClient = new AWS.Translate();
    try {
        const translation = await translateClient.translateText(params).promise();
        return translation;
    } catch (err) {
        console.log("warning - error during translation. Returning: " + inputText);
        const res = {};
        res.TranslatedText = inputText;
        return res;
    }
}

function set_userLocale(Languages, userPreferredLocale, defaultConfidenceScore, req) {
    let locale = '';
    let userDetectedLocaleConfidence = Languages.Languages[0].Score;
    let userDetectedLocale = Languages.Languages[0].LanguageCode;
    let isPreferredLanguageDetected = false;
    let i = 0;
    let userDetectedSecondaryLocale;

    console.log("preferred lang", userPreferredLocale);
    for (i = 0; i <= Languages.Languages.length - 1; i++) {
        console.log("found lang: " + Languages.Languages[i].LanguageCode);
        console.log("score: " + Languages.Languages[i].Score);
        if (Languages.Languages[i].LanguageCode === userPreferredLocale) {
            isPreferredLanguageDetected = true;
            userDetectedLocale = Languages.Languages[i].LanguageCode;
        }
        if (i > 0 && Languages.Languages[i].LanguageCode !== 'en' && userDetectedSecondaryLocale === undefined) {
            userDetectedSecondaryLocale = Languages.Languages[i].LanguageCode;
        }
    }
    console.log("isPreferredLanguageDetected", isPreferredLanguageDetected);
    console.log("detected locale", userDetectedLocale);
    console.log("detected secondary locale", userDetectedSecondaryLocale);
    console.log("detected Confidence", userDetectedLocaleConfidence);

    _.set(req.session, "userDetectedLocale", userDetectedLocale);
    _.set(req.session, "userDetectedLocaleConfidence", userDetectedLocaleConfidence);
    if (userDetectedSecondaryLocale) {
        _.set(req.session, "userDetectedSecondaryLocale", userDetectedSecondaryLocale);
    } else {
        if (req.session.userDetectedSecondaryLocale) delete req.session.userDetectedSecondaryLocale;
    }

    if (userPreferredLocale && userDetectedLocale !== '') {
        locale = userPreferredLocale;
        console.log("set user preference as language to use: ", locale);
    } else if ((userPreferredLocale === undefined || userPreferredLocale === '') && userDetectedLocaleConfidence <= defaultConfidenceScore) {
        locale = 'en'; // default to english
        console.log("Detected language confidence too low, defaulting to English");
    } else {
        locale = userDetectedLocale;
        console.log("set detected language as language to use: ", locale);
    }
    return locale;
}

async function set_translated_transcript(locale, req) {
    const SessionAttributes = _.get(req, 'session');
    const detectedLocale = SessionAttributes.userDetectedLocale;
    const detectedSecondaryLocale = SessionAttributes.userDetectedSecondaryLocale;

    if (locale === 'en' && detectedLocale === 'en' && detectedSecondaryLocale === undefined) {
        console.log("No translation - english detected");
    } else if (locale === 'en' && detectedLocale === 'en' && detectedSecondaryLocale) {
        console.log("translate to english using secondary detected locale:  ", req.question);
        const translation = await get_translation(req.question, detectedSecondaryLocale, 'en');
        _.set(req, "_translation", translation.TranslatedText);
        _.set(req, "question", translation.TranslatedText);
        console.log("Overriding input question with translation: ", req.question);
    }  else if (locale !== '' && locale.charAt(0) !== '%' && detectedLocale && detectedLocale !== '') {
        console.log("Confidence in the detected language high enough.");
        const translation = await get_translation(req.question, detectedLocale, 'en');
        _.set(req, "_translation", translation.TranslatedText);
        _.set(req, "question", translation.TranslatedText);
        console.log("Overriding input question with translation: ", req.question);
    }  else {
        console.log ('not possible to perform language translation')
    }

}

exports.set_multilang_env = async function (req) {
    // Add QnABot settings for multilanguage support
    console.log("Entering multilanguage Middleware");
    console.log("req:", req);

    let userLocale = '';
    const defaultConfidenceScore = req._settings.MINIMUM_CONFIDENCE_SCORE;
    const userLanguages = await get_userLanguages(req.question);
    const userPreferredLocale = req.session.userPreferredLocale ? req.session.userPreferredLocale : '';
    userLocale = set_userLocale(userLanguages, userPreferredLocale, defaultConfidenceScore, req);
    _.set(req.session, "userLocale", userLocale);
    _.set(req._event, "origQuestion", req.question);
    await set_translated_transcript(userLocale, req);

    return req;
}

async function translateText(inputText, sourceLang, targetLang) {
    const res = await get_translation(inputText, sourceLang, targetLang);
    return res.TranslatedText;
}

exports.translateText = translateText;

exports.translate_res = async function (req, res) {
    const locale = _.get(req, 'session.userLocale');
    if (_.get(req._settings, 'ENABLE_MULTI_LANGUAGE_SUPPORT', "false").toLowerCase() === "true"){
        if (_.get(res,"message")) {
            res.message = await translateText(res.message,'en',locale);
        }
        if (_.get(res,"plainMessage")) {
            res.plainMessage = await translateText(res.plainMessage,'en',locale);
        }
        if (_.get(res,"card")) {
            res.card.title = await translateText(res.card.title,'en',locale);
        }
        if (_.get(res,"card.buttons")) {
            res.card.buttons.forEach(async function (button) {
                button.text = await multilanague.translateText(button.text,'en',locale);
                //TODO Address multilanguage issues with translating button values for use in confirmation prompts
                //Disable translate of button value
                //button.value = await translate.translateText(button.value,'en',locale);
            });
            res.plainMessage = await translateText(res.plainMessage,'en',locale);
        }
    }
    return res;
}