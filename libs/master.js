require('sanic.js').changeMyWorld();

const fs = require('fs-extra');
const program = require('commander');
const sprintf = require('sprintf');
const cluster = require('cluster');
const Netmask = require('netmask').Netmask;
const ipInt = require('ip-to-int');
const extend = require('util')._extend;
const common = require('./common');
const async = require('async');
const cidrClean = require('cidr-clean');
const moment = require('moment');
const util = require('util');
const chalk = require('chalk');
const sockmq = process.sockmq;
const debug = require('debug')('evildns:master');

require('draftlog').into(console);
require('moment-duration-format');

const defaultOptions = {
    workersMax:10
};

const filteredDomains = {
    'crawlers': {
        fqdnKeywords:['crawl', 'bot']
    }
};

const workers = {};
const cidrListClean = [];
const progress = {};
const startTime = Date.now();
const dataDir = 'tree/';
const showWorkersStatsInterval = 100;
const workersStatLine = [];
const fqdnFoundKeepMax = 20;
const fqdnStatLines = [];
const fqdnFound = [];
const carretLength = 100;

let opts = {};
let verbose = false;
let options = {};
let cidrFile = '';
let cidrList;
let tmpCidrFile;
let totalIPCount = 0;
let totalDone = 0;
let workersQueue;
let masterStatLine;

let logger;

const loggerConsole = {
    log() {
        verbose && console.log.apply(console, formatArgs(arguments));
    },
    warn() {
        console.warn.apply(console, formatArgs(arguments));
    },
    error() {
        console.error.apply(console, formatArgs(arguments));
    }
};

function progressBar(progress) {
    debug('progressBar', progress);
    // Make it 25 characters length
    const divider = 6;
    progress = Math.min(100, progress);
    const units = Math.round(progress / divider);
    return '[' +
        '='.repeat(units) +
        ' '.repeat(Math.round(100/divider) - units) +
        '] ' +
        chalk.yellow(sprintf('%2s%%', progress));
}

function formatArgs(args){
    return [util.format.apply(util.format, Array.prototype.slice.call(args))];
}

function onWorkerForked(worker) {
    debug('onWorkerForked');
    if (!opts.progress) return;

    let line, lineIndex;

    for (let i=0; i<workersStatLine.length; i++) {
        if (!workersStatLine[i].busy) {
            line = workersStatLine[i];
            lineIndex = i;
            workersStatLine[i].busy = true;
            break;
        }
    }

    line(
        chalk.blue(sprintf('%-20s', worker.cidr)),
        progressBar(0)
    );

    worker.lineIndex = lineIndex;
    workersStatLine[worker.lineIndex] = line;

}

function onReverseFound(ev, data) {

    debug('onReverseFound', data);

    let dh;
    let dhh;
    let dir;

    data.hostnames.forEach((h) => {

        ///////////////////////////////////////////
        // write normal reverse found in the tree
        ///////////////////////////////////////////

        // 115.15.102.66.bc.googleusercontent.com must create a tree
        // com/googleusercontent/bc and not com/googleusercontent/bc/66/102/15/115
        dhh = h.replace(/([0-9]+)\.([0-9]+)/g, '$1=$2');
        dhh = dhh.replace(/([0-9]+)\.([0-9]+)/g, '$1=$2');
        dh = dhh.split('.').reverse();
        dh.forEach((p, i)=>{
            dh[i] = p.replace(/=/, '.');
        });

        // remove first subdomain part
        dh.pop();

        dir = dataDir + dh.join('/');
        fs.ensureDirSync(dir);

        verbose && logger.log(
            sprintf(
                '%-20s: found %s => %s',
                data._emitter,
                data.ip,
                h
            )
        );

        fqdnFound.push(h);
        if (fqdnFound.length>fqdnFoundKeepMax) {
            fqdnFound.shift();
        }

        fs.appendFile(
            dir + '/data.csv',
            data.ip+'|'+h+'|'+Date.now()+'\n',
            function (err) {
                if (err) logger.error(err);
            }
        );

        ///////////////////////////////////////////
        // write special reverse found in the tree
        ///////////////////////////////////////////

        Object.keys(filteredDomains).forEach((prefix) => {
            filteredDomains[prefix].re.forEach((re) => {
                if (h.match(re)) {

                    verbose && logger.log(
                        sprintf(
                            '%-20s: found %s => %s/%s',
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
                            if (err) logger.error(err);
                        }
                    );
                }
            });
        });
    });
}

function showStatWorker(cidr) {

    if (!workers[cidr].stats) return;

    if (opts.progress) {
        const stats = workers[cidr].stats;
        const line = workersStatLine[workers[cidr].lineIndex];
        if (stats.progress <= 100) {
            line.busy = true;
            line(
                chalk.green(sprintf('%-20s', cidr)),
                progressBar(stats.progress || 0),
                sprintf('%-15s', stats.done + '/' + stats.total),
                sprintf('%6s', stats.reversePerSec + '/s'),
                '| ' + stats.currentIP
            );
        } else {
            line.busy = false;
        }
    }

    return workers[cidr].stats.reversePerSec||0;
}

function showStats() {
    debug('showStats');
    let reversePerSec = 0;
    let elapsedTime = 'N/A';
    let remainingTime = 'N/A';
    let progressPercent = 0;

    Object.keys(workers).forEach((cidr) => {
        reversePerSec+=showStatWorker(cidr)||1;
    });

    if (reversePerSec) {
        elapsedTime =
            moment
                .duration(Date.now() - startTime, 'ms')
                .format('hh:mm:ss', { trim: false });

        remainingTime =
            moment
                .duration(Math.round((totalIPCount - totalDone) / reversePerSec), 'seconds')
                .format('hh:mm:ss', { trim: false });

        progressPercent = Math.floor((totalDone * 100) / totalIPCount);

    }

    if (!opts.quiet) {

        const str = sprintf(
            '%s%% done since %s, remaining %s (%s reverse per sec) (%s/%s)' +
            '               \r',
            progressPercent,
            elapsedTime,
            remainingTime,
            reversePerSec,
            totalDone,
            totalIPCount
        );

        if (opts.progress) {
            masterStatLine(chalk.blue(str));

            fqdnFound.forEach((fqdn, i)=> {
                fqdnStatLines[i](fqdn);
            });

        } else {
            process.stdout.write(str);
        }
    }

}

function workerFork(cidr, nextFork) {

    debug('workerFork');

    if (verbose) {
        const block = new Netmask(cidr);
        console.log(
            sprintf(
                '%-20s: create worker (%s IPs to reverse)',
                cidr,
                block.size-2
            )
        );
    }

    var tmpArgs = JSON.parse(JSON.stringify(process.argv));
    tmpArgs.shift();
    tmpArgs.shift();
    tmpArgs.push('--ps ' + cidr);

    cluster.settings = {
        args: tmpArgs,
        silent: false,
        execArgv:['--expose_gc']
    };

    const w = cluster.fork({ cidr });
    w.cidr = cidr;
    w.done = 0;

    w.on('exit', function() {

        verbose && console.log(
            sprintf(
                '%-20s: job done (%s IPs reversed)',
                this.cidr,
                this.done
            )
        );

        delete workers[this.cidr];

        nextFork();

    });

    workers[cidr] = w;
    onWorkerForked(w);
}

function cleanUp(arr) {
    debug('cleanup');
    const arrOut = [];
    arr.forEach((item) => {
        item = item.trim();
        if (item && item[0]!='#') {
            arrOut.push(item);
        }
    });
    return arrOut;
}

function initWorkersQueue() {
    workersQueue = async.queue(workerFork, options.workersMax);

    workersQueue.drain(() => {
        showStats();
        setTimeout(() => {
            logger.log();
            process.exit(0);
        }, 500);
    });

    cidrListClean.forEach((cidr)=>{
        workersQueue.push(cidr);
    });
}

function initStats() {
    setInterval(showStats, showWorkersStatsInterval);

    if (!opts.progress) return;

    console.log('-'.repeat(carretLength));

    let i = options.workersMax;
    while (i--) workersStatLine.push(console.draft());

    console.log('-'.repeat(carretLength));

    i = fqdnFoundKeepMax;
    while (i--) fqdnStatLines.push(console.draft());

    console.log('-'.repeat(carretLength));

    masterStatLine = console.draft();
}

function initWorkersToMasterEvents() {

    debug('initWorkersToMasterEvents');

    sockmq.on('workerReady', (ev, data) => {
        const cidr = data._emitter;
        debug('workerReady', cidr);
        let cache;
        try {
            cache = fs.readJsonSync(common.getCidrFile(cidr));
        } catch(e) {
            cache = {};
        }
        progress[data._emitter] = cache;
        sockmq.send(data._emitter+':start', progress[data._emitter]);
    });

    sockmq.on('workerProgress', (ev, data) => {
        progress[data._emitter] = extend(progress[data._emitter], data);
        fs.outputJsonSync(common.getCidrFile(data._emitter), progress[data._emitter]);
    });

    sockmq.on('workerStats', (ev, stats) => {
        if (stats.done) {
            workers[stats._emitter].added = stats.done - workers[stats._emitter].done;
            workers[stats._emitter].done = stats.done;
        }
        workers[stats._emitter].stats = stats;
        totalDone+=workers[stats._emitter].added||0;
    });

    sockmq.on('workerReverseFound', onReverseFound);

}

function initSpecialsDomainsMatch() {
    // precompile filtered domain names
    Object.keys(filteredDomains).forEach((prefix) => {
        filteredDomains[prefix].fqdnKeywords.forEach((fqdnKeyword) => {
            if (!filteredDomains[prefix].re) filteredDomains[prefix].re = [];
            filteredDomains[prefix].re.push(new RegExp(fqdnKeyword, 'i'));
        });
    });
}

function initCache() {

    debug('initCache', cidrList);

    cidrList.forEach((cidr/*, idx*/) =>  {

        const block = new Netmask(cidr);
        totalIPCount+=block.size-2; // we don't care of .0 and .255

        cidrListClean.push(cidr);

        tmpCidrFile = common.getCidrFile(cidr);

        if (opts.rebuildCache || !fs.pathExistsSync(tmpCidrFile)) {

            verbose && logger.log(
                sprintf(
                    '%-20s: preparing local cache %s',
                    cidr,
                    tmpCidrFile
                )
            );

            const cacheInfo = {
                first:ipInt(block.first).toInt(),
                current:0,
                last:ipInt(block.last).toInt()
            };

            cacheInfo.size = cacheInfo.last - cacheInfo.first +1;

            fs.outputJsonSync(tmpCidrFile, cacheInfo);
            debug('write', tmpCidrFile);
        }
    });

    logger.log('Number of IPs to reverse: %s', totalIPCount);
}

function initProgram() {
    program
        .arguments('<cidrFile>')
        .action((f) => {
            cidrFile = f;
        })
        .option('-r, --rebuild-cache', 'Rebuild local cache')
        .option('-p, --progress', 'Show progress')
        .option('-v, --verbose', 'Verbose')
        .option('-q, --quiet', 'Quiet')
        .parse(process.argv);

    opts = program.opts();
    debug('initProgram', opts);

    if (!cidrFile) {
        program.outputHelp();
        process.exit();
    }

    cidrList = fs.readFileSync(cidrFile).toString().split('\n');
    cidrList = cleanUp(cidrList);
    cidrList = cidrClean(cidrList);

    if (!cidrList || !cidrList.length) {
        console.log('error: %s does not contain any CIDR range', cidrFile);
        process.exit();
    }

    verbose = opts.verbose;
    logger = loggerConsole;
}

function init(opts) {

    options = extend(defaultOptions, opts);

    initProgram();
    initCache();
    initSpecialsDomainsMatch();
    initWorkersToMasterEvents();
    initWorkersQueue();
    initStats();
}

module.exports = init;
