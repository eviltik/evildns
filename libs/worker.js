require('sanic.js').changeMyWorld();
const sprintf = require('sprintf');
//const common = require('./common');
const ipInt = require('ip-to-int');
const async = require('async');
const dns = require('dns');
const debug = require('debug')('evildns:worker');

const sockmq = process.sockmq;

const verbose = false;
const maxParallel = 100;

//let tmpCidrFile;
//let cidr;
let first;
let last;
let current;
let currentIP;
let status;
let saturated = false;
let loopLast;
let loopFirst;
let loopI;
let timerGc;

let countDone = 0;
let countIp = 0;
let reversePerSec = 0;
let lastCountDone = 0;

let deltaRequeued = 0;
let countRequeued = 0;
let lastCountRequeued = 0;

let countNotfound = 0;

let timerUpdateStatus;
const intervalUpdateStatus = 1000;
const intervalGc = 30 * 1000;

const resolveExecWithTimeout = async.timeout(resolveExec, 3000);

const q = async.queue(resolveExecWithTimeout, maxParallel);
q.drain(onQueueDrain);
q.unsaturated(onQueueUnsaturated);
q.saturated(onQueueSaturated);

function onQueueDrain() {
    // queue is empty, all ip have been reversed
    debug('onQueueDrain');
}

function onQueueSaturated() {
    saturated = true;
    debug('onQueueSaturated');
}

function onQueueUnsaturated() {
    debug('onQueueUnsaturated');
    if (!saturated) {
        return;
    }
    saturated = false;
    populateQueue();
}

function resolveExec(ipDec, callback) {
    current = ipDec;
    currentIP = ipInt(ipDec).toIP();
    debug('resolveExec', currentIP);

    // because of queue/event loop, currentIP can change
    const tmpCurrentIP = ipInt(ipDec).toIP();

    try {
        setTimeout(() => {
            dns.reverse(tmpCurrentIP, (err, hostnames) => {
                if (err) {
                    return onResolve(callback, err, ipDec, tmpCurrentIP);
                }
                return onResolve(callback, null, ipDec, tmpCurrentIP, hostnames);
            });
        }, 200);
    } catch (err) {
        return onResolve(callback, err, ipDec, tmpCurrentIP);
    }

}

function onResolve(next, err, ipDec, ip, hostnames) {
    if (err) {
        debug(err);
    } else {
        debug('onResolve', ip, hostnames);
    }

    if (err) {
        if (err.message) {
            if (err.message.match(/ENOTFOUND/)) {
                countNotfound++;
                countDone++;
                return next();
            }

            if (err.message.match(/timed out/)) {
                countRequeued++;
                q.push(ipDec);
                return next();
            }

            console.log(err);
        }

        // unhandle exception ??
        throw Error(err);
    }

    countDone++;

    if (hostnames) {
        sockmq.send('master:workerReverseFound', {
            ipDec,
            ip,
            hostnames
        });
    }

    return next();
}

function populateQueue() {

    debug('populateQueue');

    if (!current) {
        loopFirst = first;
        loopLast = first+maxParallel;
    } else {
        loopFirst = current+1;
        loopLast = loopFirst+(maxParallel-q.running());
    }

    if (loopLast>last) {
        loopLast = last;
    }

    for (loopI=loopFirst; loopI<=loopLast; loopI++) {
        q.push(loopI);
    }
}

function start() {
    debug('start');
    first = status.first;
    last = status.last;
    current = status.current;
    countIp = status.size;
    populateQueue();
}

function updateStatus() {
    debug('updateStatus');
    reversePerSec = (countDone-lastCountDone)/(intervalUpdateStatus/1000);
    deltaRequeued = countRequeued-lastCountRequeued;

    const stats = {
        done:countDone,
        total:countIp,
        progress:(Math.floor((countDone * 100) / countIp))||0,
        reversePerSec,
        notFound:countNotfound,
        currentIP,
        current,
        requeued:deltaRequeued
    };

    verbose && console.log(
        '%s/%s %s%, notfound %s, current %s, requeued %s, avg %s reverse/s',
        stats.done,
        countIp,
        stats.progress,
        stats.notFound,
        stats.currentIP,
        stats.requeued,
        stats.reversePerSec
    );

    lastCountDone = countDone;
    lastCountRequeued = countRequeued;

    sockmq.send('master:workerProgress', { latest:current });

    if (countDone === countIp) {
        debug('done');

        clearInterval(timerGc);
        clearInterval(timerUpdateStatus);

        stats.finished = true;
        sockmq.send('master:workerStats', stats);
        sockmq.disconnect(() => {
            // let master refresh stats :)
            setTimeout(() => {
                process.exit(0);
            }, 2000);
        });
        return;
    }
    sockmq.send('master:workerStats', stats);
}

function forceGC() {
    debug('forceGC');
    global.gc && global.gc();
}

function onSockmqStart(ev, data) {
    debug('onSockmqStart', data);
    status = data;
    start();
    timerUpdateStatus = setInterval(updateStatus, intervalUpdateStatus);
}

function init() {
    const cidr = process.env.cidr;
    debug('init', cidr);
    //tmpCidrFile = common.getCidrFile(cidr);

    verbose && console.log(
        sprintf(
            '%-20s: starting reverse',
            cidr
        )
    );

    sockmq.on('start', onSockmqStart);
    sockmq.send('master:workerReady');

    if (global.gc) {
        timerGc = setInterval(forceGC, intervalGc);
    }
}

module.exports = init;
