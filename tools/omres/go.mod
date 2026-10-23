module omres

go 1.22

require github.com/tc-hib/winres v0.3.1

require (
	github.com/nfnt/resize v0.0.0-20180221191011-83c6a9932646 // indirect
	golang.org/x/image v0.15.0 // indirect
)

replace (
	github.com/tc-hib/winres => ../../.cache/gosrc/winres
	github.com/nfnt/resize => ../../.cache/gosrc/resize
	golang.org/x/image => ../../.cache/gosrc/image
)
