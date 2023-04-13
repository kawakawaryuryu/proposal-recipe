import crypto from 'crypto';
import { Configuration, OpenAIApi } from 'openai';
import line from '@line/bot-sdk';

export const handler = async(event) => {
    console.log(JSON.stringify(event));
    
    const response = {
        statusCode: 200
    };
    
    const requestBody = event.body;
    
    // read line channel secret from parameter store
    const channelSecret = await getSecret('line_channel_secret');
    
    // verify signature
    const requestBodyStr = JSON.stringify(requestBody);
    const receivedSignature = event['x-line-signature'];
    if (!isValidSignature(channelSecret, requestBodyStr, receivedSignature)) {
        console.log('invalid signature! generatedSignature: ', generateSignature(channelSecret, requestBodyStr), 'receivedSignature: ', receivedSignature);
        return response;
    }
    
    // check if events array is not empty
    if (requestBody.events.length === 0) {
        console.log('events is empty. The request is for connectivity check');
        return response;
    }
    
    // extract message
    const message = extractMessage(requestBody.events);
    
    // ask recipe to openai
    const replyMessage = await askRecipe(message);
    console.log('openai reply:', replyMessage);
    
    // extract reply token
    const replyToken = extractReplyToken(requestBody.events);
    
    // send message to LINE
    await reply(replyMessage, replyToken);
    
    console.log('replay successed!')
    
    return response;
};

const isValidSignature = (channelSecret, reqeustBody, receivedSignature) => {
    // Compare x-line-signature request header and the signature
    return generateSignature(channelSecret, reqeustBody) === receivedSignature;
};

const generateSignature = (channelSecret, reqeustBody) => {
    return crypto
    .createHmac("SHA256", channelSecret)
    .update(reqeustBody)
    .digest("base64");
};

const getSecret = async(keyName) => {
    const sessionToken = process.env.AWS_SESSION_TOKEN;
    const init = {
        method: 'GET',
        headers: {
            'X-Aws-Parameters-Secrets-Token': sessionToken
        }
    };
    const res = await fetch(`http://localhost:2773/systemsmanager/parameters/get?name=${keyName}&withDecryption=true`, init);
    const json = await res.json();
    return json.Parameter.Value;
};

const extractMessage = (events) => {
    return extractFirstMessageObject(events).message.text;
};

const extractReplyToken = (events) => {
    return extractFirstMessageObject(events).replyToken;
};

const extractFirstMessageObject = (events) => {
    const messageObjects = events.filter(obj => obj.type === 'message');
    if (messageObjects.length === 0) {
        throw Error('not found message object');
    }
    return messageObjects[0];
};

const askRecipe = async(content) => {
    const apiKey = await getSecret('openai_api_key');
    const configuration = new Configuration({ apiKey });
    const openai = new OpenAIApi(configuration);
    
    const completion = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        messages: [
            {
                "role": "system",
                "content": "あなたは優秀な料理人です。これから指定する食材や調味料から作れる料理名とそのレシビを教えて下さい。"
                
            },
            {
                "role": "user",
                content
                
            }
        ]
    });
    return completion.data.choices[0].message.content;
};

const reply = async(text, replyToken) => {
    const channelAccessToken = await getSecret('line_channel_access_token');
    const client = new line.Client({
      channelAccessToken
    });
    
    const message = {
      type: 'text',
      text
    };
    
    try {
        await client.replyMessage(replyToken, message);
    } catch (e) {
        throw e;
    }
};