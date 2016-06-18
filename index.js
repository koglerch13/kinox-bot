/*jshint esversion: 6 */
const requestify = require('requestify');
const cheerio = require('cheerio');
const telegram = require('telegram-bot-api');
const Datastore = require('nedb');

//Telegram
const TELEGRAM_TOKEN = "182972859:AAGvGMOG6Fo-z-Mp3ZpODWgc6pXIt2H4krc";
const api = new telegram({token: TELEGRAM_TOKEN, updates: {enabled: true}});

//Kinox
const KINOX_REGEX = new RegExp("http.?\\://kinox\\.\\w\\w\\/Stream\\/.*\\.html");
const TITLE_REGEX = new RegExp("(.*)\\((\\d{4})\\)");

//config
const interval = 10000;
const scheduleInterval = 20000;

//Database
const db = new Datastore({filename: 'datastore', autoload: true}); 

//Messages
const START_MESSAGE = "Hi! Send me your links, and I will notify you if new episodes arrive ;-)";
const FAIL_MESSAGE = "Sorry, your message appears to have the wrong format :-(\nPlease send me a valid Kinox.tv-link.";
const SUCCESS_MESSAGE = "Thanks! You will be informed, as soon as a new Episode is available!";
const NOTIFY_MESSAGE = (title) => { return 'A new episode of "' + title + '" is now available!';};

const scrape = (url) => {
    return requestify.get(url).then((response) => {
        var $ = cheerio.load(response.getBody());
        var title = TITLE_REGEX.exec($('title').text())[1];
        if(title === null) { reject("No title"); }
        var seasons = $('#SeasonSelection option').toArray();
        var episodes = seasons.reduce((previous, current) => {
            return previous + current.attribs.rel.split(",").length;
        }, 0);
        return {url: url, title: title, episodes: episodes};
    });
};

const find = (url) => {
    return new Promise(function(resolve, reject) {
        db.findOne({url: url}, (error, doc) => {
            if(error) { reject(error); }
            if(doc) {
                resolve(doc);
            } else {
                resolve(null);
            }
        });
    });
};

const findAll = () => {
    return new Promise(function(resolve, reject) {
        db.find({}, (error, documents) => {
            if(error) { reject(error); }
            resolve(documents);
        });
    });
};

const create = (url, title, episodes, lastVisited) => {
    return new Promise(function(resolve, reject) {
        var entry = {
            url: url,
            title: title,
            episodes: episodes,
            lastVisited: lastVisited || 0,
            subscribers: []
        };
        db.insert(entry, function(error, document) {
            if(error) { reject(error); }
            resolve(document);
        });
    });
};

const updateDatabase = (url, episodes, lastVisited) => {
    return new Promise(function(resolve, reject) {
        db.update({url: url}, {$set: {episodes: episodes, lastVisited: lastVisited}}, {}, function(error, numReplaced) {
            if(error) { reject(error); }
            resolve(numReplaced);
        });
    });
};

const subscribe = (url, chat) => {
    return new Promise(function(resolve, reject) {
        db.update({url: url}, {$addToSet: {subscribers: chat}}, {}, function(error, numReplaced) {
            if(error) { reject(error); }
            resolve(numReplaced);
        });
    });
   
};

const sendMessage = (chat, message) => {
    return api.sendMessage({
        chat_id: chat,
        text: message
    });
};


//handle received messages
api.on('update', (response) => {
    var message = response.message.text;
    var chat = response.message.chat.id;
    if (message === "/start") {
        sendMessage(chat, START_MESSAGE);
    } else if (KINOX_REGEX.test(message)) {
        //subscribe and everything
        find(message).then((result) => {
            if(!result) {
                return scrape(message).then((result) => {
                    return create(result.url, result.title, result.episodes);
                });
            }
        })
        .then((document) => {
            return subscribe(message, chat);
        })
        .then(() => {
            return sendMessage(chat, SUCCESS_MESSAGE);
        });
    } else {
        sendMessage(chat, FAIL_MESSAGE);
    }
});

//scrape regularly
const scheduled = () => {
    findAll().then((docs) => {
        docs.forEach((item, index) => {
            scrape(item.url)//TODO check lastVisited
            .then((scrapeResult) => {
                return find(item.url).then((dbResult) => {
                    return(scrapeResult.episodes > dbResult.episodes);
                })
                .then((newEpisodes) => {
                    if(newEpisodes) {
                        updateDatabase(item.url, scrapeResult.episodes);
                        item.subscribers.forEach((subscriber) => {
                            sendMessage(subscriber, NOTIFY_MESSAGE(item.title));
                        });
                    }
                });
            });
        });
    });
};

scheduled();//init
setInterval(scheduled, scheduleInterval);