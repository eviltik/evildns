const cluster = require('cluster');
const sockmq = require('sockmq');

const sockmqProtocol = 'tcp';// ipc or tcp
const sockmqVerbose = false;

process.sockmq = sockmq;

if (cluster.isMaster) {

    sockmq.startServer({transport: sockmqProtocol, verbose: sockmqVerbose}, function() {
        require('./libs/master')();
    });

} else {

    process
        .on('unhandledRejection', (reason, p) => {
            console.error(reason, 'Unhandled Rejection at Promise', p);
        })
        .on('uncaughtException', err => {
            console.error(err, 'Uncaught Exception thrown');
            process.exit(1);
        });

    sockmq.connect({
        transport:sockmqProtocol,
        forkId:process.env.cidr,
        verbose:sockmqVerbose
    }, function() {
        require('./libs/worker')();
    });

}
