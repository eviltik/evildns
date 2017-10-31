# evildns

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
$ evildns -r allocations/microsoft/cidr.txt
 ░░░░░░░░░░░░░░░░░░░░░░ 0% | ETA: 9567s | 11045/21059548

```

Tree created, example 1:
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



Help
-----
```
$ evildns ---help

  Usage: evildns [options] <cidrFile>


  Options:

    -r, --rebuild-cache  Rebuild local cache
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

