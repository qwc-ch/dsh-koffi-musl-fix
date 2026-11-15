/**
 * Plain Node preload entry point.
 *
 *   NODE_OPTIONS="--import koffi-musl-fix/preload" node app.mjs
 *
 * Importing this module installs the redirect before the application loads
 * koffi. It is a no-op outside Linux/musl.
 */
import { install } from './lib/core.mjs'

install()
