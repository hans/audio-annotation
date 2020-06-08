import { useState, useRef, useEffect, useCallback, MutableRefObject, RefObject } from 'react'
import * as Types from '../Types'
import _ from 'lodash'
import { batched, apihost } from '../Misc'
import { useRouter } from '../Misc'
import queryString from 'query-string'

export function isStateLoaded(
    state: MutableRefObject<{
        movie: string | undefined
        startTime: Types.TimeInMovie | undefined
        endTime: Types.TimeInMovie | undefined
        user: string | undefined
        references: string[] | undefined
        defaultReference: string | undefined
    }>
) {
    return (
        _.isUndefined(state.current.movie) ||
        _.isUndefined(state.current.startTime) ||
        _.isUndefined(state.current.endTime) ||
        _.isUndefined(state.current.user) ||
        _.isUndefined(state.current.references) ||
        _.isUndefined(state.current.defaultReference)
    )
}

export function useAnnotationState(): [
    MutableRefObject<{
        movie: string | undefined
        startTime: Types.TimeInMovie | undefined
        endTime: Types.TimeInMovie | undefined
        user: string | undefined
        references: string[] | undefined
        defaultReference: string | undefined
    }>,
    (value: any) => void,
    (value: any) => void,
    (value: any) => void,
    (value: any) => void,
    (value: any) => void,
    (value: any) => void
] {
    const router = useRouter()
    const [redrawState, redraw] = useState(0)

    useEffect(() => {
        // @ts-ignore
        state.current.movie = router.query.movie
        // @ts-ignore
        state.current.startTime = Types.to<Types.TimeInMovie>(parseInt(router.query.startTime))
        // @ts-ignore
        state.current.endTime = Types.to<Types.TimeInMovie>(parseInt(router.query.endTime))
        // @ts-ignore
        state.current.user = router.query.user
        // @ts-ignore
        if (!_.isEqual(state.current.references, _.split(router.query.references, ',')))
            // @ts-ignore
            state.current.references = _.split(router.query.references, ',')
        // @ts-ignore
        state.current.defaultReference = router.query.defaultReference
        if (redrawState != 1) {
            redraw(1)
        }
    }, [router])

    const updateRouter = useCallback(
        (name: string) => (value: any) => {
            // @ts-ignore
            if (_.isEqual(state.current[name], value)) return
            // @ts-ignore
            state.current[name] = value
            let q = {
                movie: state.current.movie,
                startTime: Types.from(state.current.startTime!),
                endTime: Types.from(state.current.endTime!),
                user: state.current.user,
                references: _.join(state.current.references, ','),
                defaultReference: state.current.defaultReference,
            }
            router.replace(router.location.pathname + '?' + queryString.stringify(q))
        },
        [router]
    )

    const state = useRef({
        movie: undefined as undefined | string,
        startTime: undefined as undefined | Types.TimeInMovie,
        endTime: undefined as undefined | Types.TimeInMovie,
        user: undefined as undefined | string,
        references: undefined as undefined | string[],
        defaultReference: undefined as undefined | string,
    })
    const setMovie = useCallback(updateRouter('movie'), [updateRouter])
    const setStartTime = useCallback((s: Types.TimeInMovie) => updateRouter('startTime')(Types.from(s)), [updateRouter])
    const setEndTime = useCallback((s: Types.TimeInMovie) => updateRouter('endTime')(Types.from(s)), [updateRouter])
    const setUser = useCallback(updateRouter('user'), [updateRouter])
    const setReferences = useCallback((ss: string[]) => updateRouter('references')(ss), [updateRouter])
    const setDefaultReference = useCallback(updateRouter('defaultReference'), [updateRouter])

    return [state, setMovie, setStartTime, setEndTime, setUser, setReferences, setDefaultReference]
}

export function useAnnotations(
    movie: string,
    setMovie: (a: string) => any,
    startTime: Types.TimeInMovie,
    setStartTime: (a: Types.TimeInMovie) => any,
    endTime: Types.TimeInMovie,
    setEndTime: (a: Types.TimeInMovie) => any,
    user: string,
    setUser: (a: string) => any,
    references: string[],
    setReferences: (a: string[]) => any,
    defaultReference: string,
    setDefaultReference: (a: string) => any,
    onSave: MutableRefObject<() => any>,
    onReload: MutableRefObject<() => any>,
    onMessageRef: RefObject<(level: Types.MessageLevel, value: string) => any>,
    afterLoad: () => any,
    shouldSave: boolean = true
): [
        MutableRefObject<{ [user: string]: Types.Annotation[] }>,
        (fn: (prev: { [user: string]: Types.Annotation[] }) => { [user: string]: Types.Annotation[] }) => void,
        MutableRefObject<{
            movie: string
            startTime: Types.TimeInMovie
            endTime: Types.TimeInMovie
            user: string
            references: string[]
            defaultReference: string
        } | null>
    ] {
    const annotations = useRef<{ [user: string]: Types.Annotation[] }>({})
    const annotationSource = useRef<{
        movie: string
        startTime: Types.TimeInMovie
        endTime: Types.TimeInMovie
        user: string
        references: string[]
        defaultReference: string
    } | null>(null)
    const isDoingIO = useRef(false)

    const setAnnotations = (
        fn: (prev: { [user: string]: Types.Annotation[] }) => { [user: string]: Types.Annotation[] }
    ) => {
        const newAnnotations = fn(annotations.current)
        if (newAnnotations != annotations.current) {
            annotations.current = newAnnotations
        }
    }

    const changeLocation = useCallback(
        (movie_, startTime_, endTime_, user_, references_, defaultReference_) => {
            save(
                true,
                batched(() => {
                    setMovie(movie_)
                    setStartTime(startTime_)
                    setEndTime(endTime_)
                    setUser(user_)
                    if (!_.isEqual(references_, references)) setReferences(references_)
                    setDefaultReference(defaultReference_)
                })
            )
        },
        [setMovie, setStartTime, setEndTime, setUser, setReferences, setDefaultReference]
    )

    const load = useCallback(
        (forceLoad: boolean = false) => {
            if (isDoingIO.current && !forceLoad) return
            if (
                _.isUndefined(movie) ||
                _.isUndefined(startTime) ||
                _.isNaN(startTime) ||
                _.isUndefined(endTime) ||
                _.isNaN(endTime)
            )
                return
            isDoingIO.current = true
            onMessageRef.current!(Types.MessageLevel.info, 'Loading...')
            fetch(
                // TODO The -4 makes sure we see annotations that fall into our segment.
                `${apihost}api/annotations?movieName=${encodeURIComponent(movie)}&startS=${encodeURIComponent(
                    Types.from(startTime) - 4
                )}&endS=${encodeURIComponent(Types.from(endTime))}&${_.join(
                    _.map(_.concat(references, user), (w: string) => 'workers=' + encodeURIComponent(w)),
                    '&'
                )}`,
                {
                    method: 'GET',
                    mode: 'cors',
                    cache: 'no-cache',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                }
            )
                .then(response => response.json())
                .then(result => {
                    _.forEach(result.allAnnotations, as => _.forEach(as, (a, key) => (a.index = key)))
                    setAnnotations(() =>
                        _.mapValues(
                            result.allAnnotations,
                            /* TODO Check this */
                            as => _.filter(as, a => !Types.isValidAnnotation(a) || Types.from(a.endTime!) > startTime)
                        )
                    )
                    annotationSource.current = {
                        movie: movie,
                        startTime: startTime,
                        endTime: endTime,
                        user: user,
                        references: references,
                        defaultReference: defaultReference,
                    }
                    onMessageRef.current!(Types.MessageLevel.success, 'Loaded segment')
                    isDoingIO.current = false
                    afterLoad()
                })
                .catch(error => {
                    onMessageRef.current!(
                        Types.MessageLevel.error,
                        'Failed to load segment! Please report to abarbu@csail.mit.edu'
                    )
                    console.log(error)
                    isDoingIO.current = false
                })
        },
        [movie, startTime, endTime, user, _.join(references, ',')]
    )

    useEffect(() => {
        onReload.current = load
    }, [load])

    const save = useCallback(
        (loadAfter: boolean, afterFn: () => any) => {
            if (!shouldSave) return
            if (isDoingIO.current) return
            if (_.isEmpty(annotationSource.current)) {
                if (loadAfter) load(true)
                return
            }
            isDoingIO.current = true
            onMessageRef.current!(Types.MessageLevel.info, 'Saving...')
            const data = {
                segment:
                    annotationSource.current!.movie +
                    ':' +
                    Types.from(annotationSource.current!.startTime) +
                    ':' +
                    Types.from(annotationSource.current!.endTime),
                browser: navigator.userAgent.toString(),
                windowWidth: window.innerWidth,
                windowHeight: window.outerWidth,
                words: _.map(annotations.current[annotationSource.current!.user], a => a.word),
                movie: annotationSource.current!.movie,
                start: Types.from(annotationSource.current!.startTime),
                end: Types.from(annotationSource.current!.endTime),
                startTime: Types.from(annotationSource.current!.startTime),
                worker: annotationSource.current!.user,
                user: annotationSource.current!.user,
                annotations: _.map(
                    _.filter(annotations.current[annotationSource.current!.user], a => Types.isValidAnnotation(a)),
                    function(a) {
                        return {
                            startTime: a.startTime!,
                            endTime: a.endTime!,
                            index: a.index,
                            word: a.word,
                        }
                    }
                ),
            }
            console.log('Sending', data)
            fetch(
                // TODO The -4 makes sure we see annotations that fall into our segment.
                apihost + 'api/submission',
                {
                    method: 'POST',
                    mode: 'cors',
                    cache: 'no-cache',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(data),
                }
            )
                .then(response => response.json())
                .then(result => {
                    afterFn()
                    if (loadAfter) load(true)
                    else {
                        onMessageRef.current!(Types.MessageLevel.success, 'Saved segment')
                        isDoingIO.current = false
                    }
                })
                .catch(error => {
                    onMessageRef.current!(
                        Types.MessageLevel.error,
                        'Failed to save segment! Please report to abarbu@csail.mit.edu'
                    )
                    /* TODO provide debugging info for all errors! */
                    console.log(error)
                    isDoingIO.current = false
                })
        },
        [movie, startTime, endTime, user, _.join(references, ','), annotations]
    )

    useEffect(() => {
        onSave.current = () => save(false, () => null)
    }, [save])

    useEffect(() => {
        changeLocation(movie, startTime, endTime, user, references, defaultReference)
    }, [movie, startTime, endTime, user, _.join(references, ','), defaultReference])

    /* return [annotations, setAnnotations, annotationSource, changeLocation] */
    return [annotations, setAnnotations, annotationSource]
}