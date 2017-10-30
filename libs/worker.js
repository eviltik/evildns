require('sanic.js').changeMyWorld();
const sprintf = require('sprintf');
const common = require('./common');
const Netmask = require('netmask').Netmask;
const ipInt = require('ip-to-int');
const async = require('async');
const dns = require('dns');

const sockmq = process.sockmq;

let verbose = false;
let tmpCidrFile;
let cidr;
let first;
let last;
let current;
let currentIP;
let status;
let maxParallel = 300;
let saturated = false;
let loopLast;
let loopFirst;
let loopI;
let stats;

let countDone = 0;
let countIp = 0;
let reversePerSec = 0;
let lastCountDone = 0;

let deltaRequeued = 0;
let countRequeued = 0;
let lastCountRequeued = 0;

let countNotfound = 0;
let updateMasterInterval = 1000;

let resolveExecWithTimeout = async.timeout(resolveExec, 3000);
let q = async.queue(resolveExecWithTimeout, maxParallel);

q.drain = onQueueDrain;
q.unsaturated = onQueueUnsaturated;
q.saturated = onQueueSaturated;

function onQueueDrain() {
    // queue is empty, all ip have been reversed
}

function onQueueSaturated() {
    //console.log('saturated');
    saturated = true;
}

function onQueueUnsaturated() {
    if (!saturated) return;
    saturated = false;
    populateQueue();
}

function resolveExec(ipDec, callback) {

    current = ipDec;
    currentIP = ipInt(ipDec).toIP();

    // because of queue/event loop, currentIP can change
    let tmpCurrentIP = ipInt(ipDec).toIP();

    try {
        dns.reverse(tmpCurrentIP, (err, hostnames) => {

            if (err) {
                return onResolve(callback, err, ipDec, tmpCurrentIP);
            }

            return onResolve(callback, null, ipDec, tmpCurrentIP, hostnames);
        });
    } catch (err) {
        return onResolve(callback, err, ipDec, tmpCurrentIP);
    }

}

function onResolve(next, err, ipDec, ip, hostnames) {

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

            // unhandle exception ??
            throw new Error(err.message);
            process.exit(1);
        }

        // unhandle exception ??
        throw new Error(err);
        process.exit(1);

        //countDone++;
        //return next();
    }

    countDone++;

    if (hostnames) {
        sockmq.send('master:reverseFound', {
            ipDec: ipDec,
            ip: ip,
            hostnames: hostnames
        });
    }

    return next();
}

function populateQueue() {

    if (!current) {
        loopFirst = first;
        loopLast = first+maxParallel;
    } else {
        loopFirst = current+1;
        loopLast = loopFirst+(maxParallel-q.running());
    }

    if (loopLast>last) loopLast = last;

    for (loopI=loopFirst; loopI<=loopLast; loopI++) {
        q.push(loopI);
    }
}

function start() {

    first = status.first;
    last = status.last;
    current = status.current;
    countIp = status.size;

    populateQueue();
}

function updateStatus() {
    reversePerSec = (countDone-lastCountDone)/(updateMasterInterval/1000);
    deltaRequeued = countRequeued-lastCountRequeued;

    let stats = {
        done:countDone,
        progress:Math.floor((countDone * 100) / countIp),
        reversePerSec:reversePerSec,
        notFound:countNotfound,
        currentIP:currentIP,
        current:current,
        requeued:deltaRequeued
    };

    verbose && console.log(
        "%s/%s %s%, notfound %s, current %s, requeued %s, avg %s reverse/s",
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

    sockmq.send('master:progress', {latest:current});

    if (countDone === countIp) {
        stats.finished = true;
        sockmq.send('master:stats', stats);
        sockmq.disconnect(function () {
            setTimeout(() => {
                process.exit(0);
            },100);
        });
    } else {
        sockmq.send('master:stats', stats);
    }

}

function forceGC() {
    global.gc && global.gc();
}

function init() {

    cidr = process.env.cidr;
    tmpCidrFile = common.getCidrFile(cidr);

    verbose && console.log(
        sprintf(
            '%-20s: starting reverse',
            process.env.cidr
        )
    );

    sockmq.on('start',function(ev,data) {
        status = data;
        start();
        setInterval(updateStatus, updateMasterInterval);
    });

    sockmq.send("master:ready");

    setInterval(forceGC, 30 * 1000);
}

module.exports = init;