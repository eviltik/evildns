function checkArguments() {
    if (!process.argv[2]) {
        console.log('Usage: evildns path/to/cidr.txt');
        process.exit();
    }
    return process.argv[2];
}

module.exports = checkArguments;