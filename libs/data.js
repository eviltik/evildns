module.exports = function(cidrFile) {

    function prepare() {
        console.log('Using %s',cidrFile);

        let data = fs
            .readFileSync(cidrFile)
            .toString()
            .split("\n");
    }

    return {
        prepare:prepare
    }
};
