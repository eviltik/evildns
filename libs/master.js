require('sanic.js').changeMyWorld();
const fs = require('fs-extra');
const program = require('commander');
const pretty = require('prettysize');
const sprintf = require('sprintf');
const cluster = require('cluster');
const Netmask = require('netmask').Netmask;
const ipInt = require('ip-to-int');
const extend = require('util')._extend;
const common = require('./common');
const async = require('async');
const moment = require('moment');
const ProgressBar = require('cli-progress');

require('moment-duration-format');

const sockmq = process.sockmq;

let defaultOptions = {
    workersMax:5
};

let verbose = false;
let workers = {};
let options = {};
let cidrFile = '';
let cidrList;
let cidrListClean = [];
let tmpCidrFile;
let progress = {};
let totalIPCount = 0;
let totalDone = 0;
let startTime = Date.now();
let dataDir = "tree/";
let showWorkersStatsInterval = 1*1000;
let workersQueue;
let bar;
let filteredDomains = {
    "_crawlers": {
        fqdnKeywords:["crawl","bot"]
    }
};

function fileSize(filename) {
    return pretty(fs.statSync(filename)["size"]);
}

function initProgram() {
    program
        .arguments('<cidrFile>')
        .action(function (f) {
            cidrFile = f;
        })
        .option('-r, --rebuild-cache', 'Rebuild local cache')
        .parse(process.argv);

    if (!cidrFile) {
        program.outputHelp();
        process.exit();
    }

    cidrList = fs.readFileSync(cidrFile).toString().split("\n");
    if (!cidrList || !cidrList.length) {
        console.log('error: %s does not contain any CIDR range', cidrFile);
        process.exit();
    }
}

function initCache() {

    cidrList.forEach(function (cidr, idx) {

        cidr = cidr.replace(/[\r]/g, "");

        if (cidr && !cidr.match(/^#/)) {

            let block = new Netmask(cidr);
            totalIPCount+=block.size-2; // we don't care of .0 and .255

            cidrListClean.push(cidr);

            tmpCidrFile = common.getCidrFile(cidr);

            if (program.rebuildCache || !fs.pathExistsSync(tmpCidrFile)) {

                verbose && console.log(
                    sprintf(
                        '%-20s: preparing local cache %s',
                        cidr,
                        tmpCidrFile
                    )
                );


                let cacheInfo = {
                    first:ipInt(block.first).toInt(),
                    current:0,
                    last:ipInt(block.last).toInt()
                };

                cacheInfo.size = cacheInfo.last - cacheInfo.first +1;

                fs.outputJsonSync(tmpCidrFile, cacheInfo);

            }
        }
    });

    verbose && console.log('Number of IPs to reverse: %s', totalIPCount);
    bar = new ProgressBar.Bar({},ProgressBar.Presets.shades_classic);
    bar.start(totalIPCount);
}

function forkMeIAmFamous(cidr, nextFork) {
    let w;

    verbose && console.log(
        sprintf(
            '%-20s: create worker',
            cidr,
            tmpCidrFile
        )
    );

    var tmpArgs = JSON.parse(JSON.stringify(process.argv));
    tmpArgs.shift();
    tmpArgs.shift();
    tmpArgs.push('--ps ' + cidr);

    cluster.settings = {
        args: tmpArgs,
        silent: false,
        execArgv:['--expose_gc']
    };

    w = cluster.fork({cidr:cidr});
    w.cidr = cidr;
    w.done = 0;

    w.on('exit',function() {

        verbose && console.log(
            sprintf(
                '%-20s: job done',
                this.cidr
            )
        );

        delete workers[this.cidr];

        nextFork();

    });

    workers[cidr] = w;
}

function onReverseFound(ev, data) {

    let dh;
    let dir;

    data.hostnames.forEach(function(h) {

        ///////////////////////////////////////////
        // write normal reverse found in the tree
        ///////////////////////////////////////////

        dh = h.split('.').reverse();
        dh.pop();
        dir = dataDir + dh.join('/');
        fs.ensureDirSync(dir);

        verbose && console.log(
            sprintf(
                '\n%-20s: found %s => %s',
                data._emitter,
                data.ip,
                h
            )
        );

        fs.appendFile(
            dir + '/data.csv',
            data.ip+'|'+h+'|'+Date.now()+'\n',
            function (err) {
                if (err) console.log(err);
            }
        );

        ///////////////////////////////////////////
        // write special reverse found in the tree
        ///////////////////////////////////////////

        Object.keys(filteredDomains).forEach((prefix) => {
            filteredDomains[prefix].re.forEach((re) => {
                if (h.match(re)) {

                    verbose && console.log(
                        sprintf(
                            '\n%-20s: found %s => %s/%s',
                            data._emitter,
                            data.ip,
                            h,
                            prefix
                        )
                    );

                    dir = dataDir + prefix+'/';
                    fs.ensureDirSync(dir);
                    fs.appendFile(
                        dir + 'data.csv',
                        data.ip+'|'+h+'|'+Date.now()+'\n',
                        function (err) {
                            if (err) console.log(err);
                        }
                    );
                }
            });
        });

    });
}

function showStats() {
    let reversePerSec = 0;

    Object.keys(workers).forEach((k) => {
        if (workers[k].stats) {
            reversePerSec+=workers[k].stats.reversePerSec||0;
        }
    });

    let elapsedTime = moment
        .duration(Date.now()-startTime, "ms")
        .format("d[d] hh:mm:ss", { trim: false });

    let remainingTime = moment
        .duration(Math.round((totalIPCount-totalDone)/reversePerSec), "seconds")
        .format("d[d] hh:mm:ss", { trim: false });

    let progressPercent = Math.floor((totalDone * 100) / totalIPCount);

    verbose && console.log(
        "%s% done since %s, remaining %s (%s reverse per sec)",
        progressPercent,
        elapsedTime,
        remainingTime,
        reversePerSec
    );

    bar && bar.update(totalDone);

}

function initEvents() {

    sockmq.on('ready',(ev, data) => {
        progress[data._emitter] = require(common.getCidrFile(data._emitter));
        sockmq.send(data._emitter+':start', progress[data._emitter]);
    });

    sockmq.on('progress', (ev, data) => {
        let d = JSON.parse(JSON.stringify(data));
        delete d._emitter;
        progress[data._emitter] = extend(progress[data._emitter], d);
        fs.outputJsonSync(common.getCidrFile(data._emitter), progress[data._emitter]);
    });

    sockmq.on('stats', (ev, stats) => {
        if (stats.done) {
            workers[stats._emitter].added = stats.done - workers[stats._emitter].done;
            workers[stats._emitter].done = stats.done;
        }
        workers[stats._emitter].stats = stats;
        totalDone+=workers[stats._emitter].added;
    });

    sockmq.on('reverseFound', onReverseFound);

}

function initWorkers() {
    workersQueue = async.queue(forkMeIAmFamous, options.workersMax);

    workersQueue.drain = function() {
        showStats();
        setTimeout(() => {
            process.exit(0);
        },500);
    };

    cidrListClean.forEach((cidr)=>{
        workersQueue.push(cidr);
    });
}

function initSpecialsDomainsMatch() {

    // precompile filtered domain names

    Object.keys(filteredDomains).forEach((prefix) => {
        filteredDomains[prefix].fqdnKeywords.forEach((fqdnKeyword) => {
            if (!filteredDomains[prefix].re) filteredDomains[prefix].re = [];
            filteredDomains[prefix].re.push(new RegExp(fqdnKeyword,'i'));
        })
    });
}

function initStats() {
    setInterval(showStats, showWorkersStatsInterval);
}

function init(opts) {

    options = extend(defaultOptions, opts);

    initProgram();
    initCache();
    initSpecialsDomainsMatch();
    initEvents();
    initWorkers();
    initStats();
}

module.exports = init;