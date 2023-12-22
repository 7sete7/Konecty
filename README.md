![Konecty](logo-konecty.png)

# Konecty Open source Tech Business Platform

## Konecty environment variables

-   `KONECTY_MODE`: Can be `production` or `development`
-   `DISABLE_KONSISTENT`: can be to `true` if you don't want Konsistent to run on the same process as Kondata. It's enabled by default.
-   `MONGO_URL`: Mongo database URL
-   `MONGO_OPLOG_URL`: Mongo database oplog URL
-   `DISABLE_REINDEX`: can be to `true` if you don't want to verify if all index are created.
-   `ROOT_URL`: your public url
-   `ALLOWED_ORIGINS`: a list of cors alloweds URLs separated by `|`
-   `LOG_REQUEST=true`: if provide all requests are loggeds
-   `DEFAULT_SMTP_HOST`: SMTP host for default email sender (**required**)
-   `DEFAULT_SMTP_PORT`: SMTP port for default email sender (**required**)
-   `DEFAULT_SMTP_USERNAME`: SMTP username for default email sender (**required**)
-   `DEFAULT_SMTP_PASSWORD`: SMTP password for default email sender (**required**)
-   `DEFAULT_SMTP_SECURE`: SMTP secure flag for default email sender
-   `DEFAULT_SMTP_TLS`: SMTP tls flag for default email sender
-   `DEFAULT_SMTP_IGNORE_TLS`: SMTP config `ignoreTLS` for nodemailer, if this is true and secure is false then TLS is not used even if the server supports STARTTLS extension
-   `DEFAULT_SMTP_TLS_REJECT_UNAUTHORIZED`: SMTP config `tls.rejectUnauthorized` for nodemailer, config would open a connection to TLS server with self-signed or invalid TLS certificate
-   `DEFAULT_SMTP_AUTH_METHOD`: SMTP config `authMethod` for nodemailer, defines preferred authentication method, defaults to ‘PLAIN’
-   `DEFAULT_SMTP_DEBUG`: SMTP config `debug` for nodemailer, if set to true, then logs SMTP traffic, otherwise logs only transaction events
-   `UI_URL`: host for ui
-   `LOG_LEVEL`: [Pino log levels](https://github.com/pinojs/pino/blob/HEAD/docs/api.md#level-string)
-   `LOG_TO_FILE`: Optional file name to write all logs. Path relative to project root

## FILE STORAGE API

-   `STORAGE`: Can be `s3` or `fs` for files and images uploads
-   `BLOB_URL`: (optional) if use external server for file upload
-   `PREVIEW_URL`: (optional) if use external file server

### s3 STORAGE SETTINGS

-   `S3_DOMAIN`: required if different of AWS eg: `digitaloceanspaces.com`
-   `S3_REGION`: S3 region
-   `S3_BUCKET`: S3 bucket
-   `S3_ACCESSKEY`: Generated for your aws account. Follow this instructions: [Where’s My Secret Access Key?](https://aws.amazon.com/blogs/security/wheres-my-secret-access-key/).
-   `S3_SECREDKEY`: Generate with instructions above (👆).
-   `S3_PUBLIC_URL`: Bucket public url

### fs STORAGE SETTINGS

-   `STORAGE_DIR`: Filesystem directory for file storage

## How to run on Docker

```
docker pull konecty/konecty
docker run --name kondata -p 3000:3000 --link mongo --env MONGO_URL=mongodb://mongo:27017/konecty --env MONGO_OPLOG_URL=mongodb://mongo:27017/local konecty/konecty
```

## REST API

Examples of REST usage can be found here: [REST](REST.md)

## Logs

-   KONDATA only log requests when **_status code_** of the response isn't 200 (OK).

## DEVELOPMENT

```
sudo apt install build-essential
meteor npm install
meteor
```
