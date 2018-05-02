# FYP_App
Messaging Application based on Whisper Protocol

## Report 
The full project report is included as a PDF called 'FYP-Report'. 

## Usage
An Ethereum Client is required to be running locally, exposing an IPC connection. {Geth}[https://github.com/ethereum/go-ethereum] was used in development of the application. It requires the Whisper sub-protocol to be explicitly turned it on on startup. An example startup command for geth is shown below.
```
geth --shh --rpc --rpccorsdomain "*" console 

```

To run the application simply run the application:
```
npm start 
```
This will start the application on localhost:4000. From here the user will be required to log in or generate new details.
