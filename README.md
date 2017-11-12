# evildns
---------
[![Dependencies](https://david-dm.org/eviltik/evildns.svg)](https://david-dm.org/eviltik/evildns)

A (massive) DNS Reverse Lookup Tool
-----------------------------------

**How it works ?**

Each CIDR lines found in a text file will create a "worker" for
reverse lookup all IPs in given CIDR range. Workers will send
result to the master proces each time an IP give a name, then, the
master process will update the "tree" result. A maximum of 5 resolvers
are working in parallel (atm).

If you stop the process for many reasons and you start it again,
it's supposed to pick up where it left off (use "-r" options to restart
from crash)

This tool does not required a database to store result (for moment). It
use disk and will create a "tree/" directory.

**Motivations**

My personal need was to create my own crawlers reputation database (IP/Reverse/UserAgent),
but you can use evildns for some other needs.


Warning
-------

This tool can be brought to send more than 3000 DNS Queries per second.
You can be blacklisted if the DNS Server is rate limited. Take care.


Installation
------------
```
$ npm install -g evildns
```

Usage
-----
```
$ evildns myCidrList.txt
[■               ] 3% | ETA: 00:12:39 | 23274/680200
```

Result provide a tree, example 1:
```
* top level domain
    * maindomain
        * data.csv

data.csv content:
    #ip | fqdn | lastupdate
    1.2.3.4|subdomain1.maindomain.topdomain|1509348777393
    1.2.3.5|subdomain1.maindomain.topdomain|1509348879073
    1.2.3.6|subdomain1.maindomain.topdomain|1509349010384
    1.2.3.7|subdomain1.maindomain.topdomain|1509349052749
    1.2.3.8|subdomain1.maindomain.topdomain|1509349083896
```


Tree created, example 2 (no limit regarding subdomain depth)
```
* top level domain
    * maindomain
        * subdomain(n)
            * data.csv

data.csv content:
    #ip | fqdn | lastupdate
    1.2.3.4|sub1.subdomain.maindomain.topdomain|1509348777393
    1.2.3.5|sub2.subdomain.maindomain.topdomain|1509348879073
    1.2.3.6|sub3.subdomain.maindomain.topdomain|1509349010384
    1.2.3.7|sub4.subdomain.maindomain.topdomain|1509349052749
    1.2.3.8|sub5.subdomain.maindomain.topdomain|1509349083896
```


Progress indicator
------------------

When using "-p" option, we can see what is going on
```
--------------------------------------------------------------------------------
209.185.108.128/25   [=================] 99% 125/126           49/s | 209.185.108.254
66.249.64.0/19       [                 ]  0%
72.14.192.0/18       [                 ]  0%
208.46.199.160/29    [                 ]  0% 0/6                0/s | 208.46.199.166
209.85.128.0/17      [                 ]  0%
216.239.32.0/19      [                 ]  0% 57/8190           37/s | 216.239.35.233
64.68.80.0/21        [=                ]  3% 75/2046           38/s | 64.68.83.233
66.102.0.0/20        [                 ]  0% 2/4094             2/s | 66.102.3.233
64.233.160.0/19      [                 ]  0% 43/8190           43/s | 64.233.163.233
108.177.0.0/17       [                 ]  0% 8/32766            8/s | 108.177.3.233
--------------------------------------------------------------------------------
oi-in-f17.1e100.net
oi-in-f18.1e100.net
any-in-2025.1e100.net
oi-in-f19.1e100.net
any-in-2026.1e100.net
any-in-2027.1e100.net
oi-in-f23.1e100.net
any-in-2028.1e100.net
any-in-2029.1e100.net
oi-in-f26.1e100.net
any-in-202b.1e100.net
oi-in-f27.1e100.net
any-in-202c.1e100.net
any-in-202d.1e100.net
oi-in-f28.1e100.net
oi-in-f31.1e100.net
any-in-2033.1e100.net
any-in-2035.1e100.net
any-in-2036.1e100.net
oi-in-f114.1e100.net
--------------------------------------------------------------------------------
0% done since 00:00:03, remaining 01:02:36 (181 reverse per sec) (328/680200)
```

Help
-----
```
$ evildns ---help

    Usage: evildns [options] <cidrFile>


    Options:

      -r, --rebuild-cache  Rebuild local cache
      -p, --progress       Show progress
      -v, --verbose        Verbose
      -q, --quiet          Quiet
      -h, --help           output usage information

```



Coming next
-----------
* Tests
* Be able to define DNS Servers ?
* Command line option to set the number of workers (default 5)
* IPv6 (need help on this)
* with sockmq:
    * make evildns distributed
    * provide realtime results (sockmq => websocket => GUI)


Resources
---------
* https://udger.com
* https://en.wikipedia.org/wiki/List_of_assigned_/8_IPv4_address_blocks
* https://udger.com/resources/ua-list
* http://viewdns.info/
* http://exfiltrated.com/querystart.php
* https://robtex.com/

