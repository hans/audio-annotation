import React, { useState, useRef, useEffect, useCallback, MutableRefObject, RefObject } from 'react'
import * as Types from '../Types'
import _ from 'lodash'
import EditorButtons from '../components/EditorButtons'
import EditorTranscript from '../components/EditorTranscript'
import EditorAdvancedButtons from '../components/EditorAdvancedButtons'
import EditorReferenceSelector from '../components/EditorReferenceSelector'
import EditorAudioOptions from '../components/EditorAudioOptions'
import { shouldRejectAnnotationUpdate } from '../components/AnnotationLayer'
import { alignWords, batched, apihost } from '../Misc'
import SpectrogramWithAnnotations from '../components/SpectrogramWithAnnotations'
import { useAnnotations } from '../hooks/useAnnotations'
import { Spin, Row, Col } from 'antd'
import { initialAudioState, playAudio, playAudioInMovie, stopAudio, AudioState } from '../components/Audio'
import { useHotkeys } from 'react-hotkeys-hook'

const keyboardShiftOffset: Types.TimeInMovie = Types.to(0.01)

function nextAnnotation(annotations: Types.Annotation[], index: number) {
    var word = _.filter(annotations, function(annotation: Types.Annotation) {
        return annotation.index > index && annotation.startTime != null
    })[0]
    if (word) return word.index
    else return null
}

function previousAnnotation(annotations: Types.Annotation[], index: number): number | null {
    var word = _.last(
        _.filter(annotations, function(annotation: Types.Annotation) {
            return annotation.index < index && annotation.startTime != null
        })
    )
    if (word) return word.index
    else return null
}

export default function EditorUI({
    movie,
    setMovie,
    startTime,
    setStartTime,
    endTime,
    setEndTime,
    user,
    setUser,
    references,
    setReferences,
    defaultReference,
    setDefaultReference,
    onSave,
    onReload,
    onMessageRef,
}: {
    movie: string
    setMovie: (a: string) => any
    startTime: Types.TimeInMovie
    setStartTime: (a: Types.TimeInMovie) => any
    endTime: Types.TimeInMovie
    setEndTime: (a: Types.TimeInMovie) => any
    user: string
    setUser: (a: string) => any
    references: string[]
    setReferences: (a: string[]) => any
    defaultReference: string
    setDefaultReference: (a: string) => any
    onSave: MutableRefObject<() => any>
    onReload: MutableRefObject<() => any>
    onMessageRef: RefObject<(level: Types.MessageLevel, value: string) => any>
}) {
    const [redrawState, setRedraw] = useState<{}>({})
    const [selected, setSelected] = useState<null | number>(null)

    const [annotations, setAnnotations, annotationSource] = useAnnotations(
        movie,
        setMovie,
        startTime,
        setStartTime,
        endTime,
        setEndTime,
        user,
        setUser,
        references,
        setReferences,
        defaultReference,
        setDefaultReference,
        onSave,
        onReload,
        onMessageRef,
        () => {
            setSelected(null)
            if (clearClickMarker.current) clearClickMarker.current()
            setRedraw({})
        }
    )

    const [isLocked, setIsLocked] = useState(false)
    /* [] -> no selection, [number] -> click, [start,end] -> region */
    const [clickPosition, setClickPositions] = useState<Types.TimeInSegment[]>([])
    const clearClickMarker = useRef<() => any>(() => null)
    const [bottomUser, setBottomUser] = useState(defaultReference)
    const [audioState, setAudioState] = useState<AudioState>(initialAudioState)
    const transcriptButtonRef = useRef<HTMLElement>(null)

    const clearMessages = useCallback(() => onMessageRef.current!(Types.MessageLevel.closed, ''), [])

    const setTopAnnotations = useCallback(
        (fn: (prev: Types.Annotation[]) => Types.Annotation[]) => {
            clearMessages()
            setAnnotations(prev => ({ ...prev, [user]: fn(prev[user]) }))
        },
        [user, annotations]
    )

    const addWord = useCallback(
        (missingWord: Types.Annotation | undefined) => {
            clearMessages()
            if (clickPosition.length > 0) {
                const start = Types.timeInSegmentToTimeInMovie(clickPosition[0], startTime)
                const lastIndex = _.findLastIndex(
                    annotations.current[user],
                    a => Types.isValidAnnotation(a) && Types.from(a.startTime!) < Types.from(start)
                )
                if (_.isUndefined(missingWord))
                    missingWord = _.head(_.filter(_.drop(annotations.current[user], lastIndex), a => !Types.isValidAnnotation(a)))
                if (!_.isUndefined(missingWord)) {
                    setAnnotations(prev => {
                        let anns = _.cloneDeep(prev[user])
                        anns[missingWord!.index].startTime = Types.timeInSegmentToTimeInMovie(clickPosition[0], startTime)
                        if (clickPosition.length == 2) {
                            anns[missingWord!.index].endTime = Types.timeInSegmentToTimeInMovie(clickPosition[1], startTime)
                        } else {
                            anns[missingWord!.index].endTime = Types.lift(start, p =>
                                Math.min(p + anns[missingWord!.index].word.length * 0.05, Types.from(endTime))
                            )
                        }
                        setSelected(missingWord!.index)
                        clearClickMarker.current()
                        setClickPositions([])
                        return {
                            ...prev,
                            [user]: Types.verifyTranscriptOrder(
                                prev[user],
                                anns,
                                onMessageRef.current!,
                                missingWord!.index,
                                Types.timeInSegmentToTimeInMovie(clickPosition[0], startTime)
                            ),
                        }
                    })
                } else {
                    /* TODO feedback */
                }
            } else {
                let selectedIdx = null as null | number
                if (!_.isNull(selected) && selected >= 0) {
                    selectedIdx = selected
                } else {
                    selectedIdx = _.findLastIndex(annotations.current[user], a => Types.isValidAnnotation(a))
                }
                if (!_.isNull(selectedIdx) && selectedIdx >= 0) {
                    setAnnotations(prev => {
                        let anns = _.cloneDeep(prev[user])
                        if (_.isUndefined(missingWord))
                            missingWord = _.head(
                                _.filter(
                                    _.drop(annotations.current[user], annotations.current[user][selectedIdx!].index),
                                    a => !Types.isValidAnnotation(a)
                                )
                            )
                        if (!_.isUndefined(missingWord)) {
                            anns[missingWord!.index].startTime = annotations.current[user][selectedIdx!].endTime
                            anns[missingWord!.index].endTime = Types.lift(annotations.current[user][selectedIdx!].endTime!, p =>
                                Math.min(p + anns[missingWord!.index].word.length * 0.05, Types.from(endTime))
                            )
                            setSelected(missingWord!.index)
                            clearClickMarker.current()
                            setClickPositions([])
                            return {
                                ...prev,
                                [user]: Types.verifyTranscriptOrder(
                                    prev[user],
                                    anns,
                                    onMessageRef.current!,
                                    missingWord!.index,
                                    annotations.current[user][selectedIdx!].endTime!
                                ),
                            }
                        } else {
                            /* TODO feedback */
                            return prev
                        }
                    })
                } else {
                    /* TODO feedback */
                }
            }
        },
        [clickPosition, setClickPositions, selected]
    )

    const onWordSelected = useCallback(
        (index: number | null, ann: Types.Annotation | null) => {
            clearMessages()
            if (!_.isNull(ann) && !_.isUndefined(ann.startTime)) {
                clearClickMarker.current()
                setSelected(index)
                if (_.isNull(index) || _.isNull(ann) || _.isUndefined(ann.startTime) || _.isUndefined(ann.endTime)) {
                    stopAudio(setAudioState)
                } else {
                    playAudioInMovie(ann.startTime, ann.endTime, setAudioState, startTime)
                }
            } else {
                if (!_.isNull(ann)) addWord(ann)
                clearClickMarker.current()
            }
        },
        [clearClickMarker, addWord, startTime]
    )

    const onStartNextWord = useCallback(() => {
        clearMessages()
        addWord(undefined)
    }, [addWord])

    const onStartWordAfterWord = useCallback(() => {
        clearMessages()
        let firstMissingWord: Types.Annotation | undefined
        let selectedIdx = null as null | number
        if (!_.isNull(selected) && selected >= 0) {
            selectedIdx = selected
        } else {
            selectedIdx = _.findLastIndex(annotations.current[user], a => Types.isValidAnnotation(a))
        }
        if (!_.isNull(selectedIdx) && selectedIdx >= 0) {
            setAnnotations(prev => {
                let anns = _.cloneDeep(prev[user])
                firstMissingWord = _.head(
                    _.filter(
                        _.drop(annotations.current[user], annotations.current[user][selectedIdx!].index),
                        a => !Types.isValidAnnotation(a)
                    )
                )
                if (!_.isUndefined(firstMissingWord)) {
                    anns[firstMissingWord!.index].startTime = annotations.current[user][selectedIdx!].endTime
                    anns[firstMissingWord!.index].endTime = Types.lift(annotations.current[user][selectedIdx!].endTime!, p =>
                        Math.min(p + anns[firstMissingWord!.index].word.length * 0.05, Types.from(endTime))
                    )
                    setSelected(firstMissingWord!.index)
                    clearClickMarker.current()
                    setClickPositions([])
                    return { ...prev, [user]: anns }
                } else {
                    /* TODO feedback */
                    return prev
                }
            })
        } else {
            /* TODO feedback */
        }
    }, [selected])

    const onPlayIndex = useCallback(
        index => {
            clearMessages()
            if (!_.isNull(index) && Types.isValidAnnotation(annotations.current[user][index])) {
                const ann = annotations.current[user][index]
                playAudioInMovie(ann.startTime!, ann.endTime!, setAudioState, startTime)
            }
        },
        [selected, user]
    )

    const onBack4s = useCallback(() => {
        clearMessages()
        clearClickMarker.current()
        setBottomUser(defaultReference)
        setStartTime(Types.addConst(startTime, -4))
        setEndTime(Types.addConst(endTime, -4))
    }, [startTime, endTime, defaultReference, setBottomUser])
    const onBack2s = useCallback(() => {
        clearMessages()
        clearClickMarker.current()
        setBottomUser(defaultReference)
        setStartTime(Types.addConst(startTime, -2))
        setEndTime(Types.addConst(endTime, -2))
    }, [startTime, endTime, defaultReference, setBottomUser])
    const onForward2s = useCallback(() => {
        clearMessages()
        clearClickMarker.current()
        setBottomUser(defaultReference)
        setStartTime(Types.addConst(startTime, 2))
        setEndTime(Types.addConst(endTime, 2))
    }, [startTime, endTime, defaultReference, setBottomUser])
    const onForward4s = useCallback(() => {
        clearMessages()
        clearClickMarker.current()
        setBottomUser(defaultReference)
        setStartTime(Types.addConst(startTime, 4))
        setEndTime(Types.addConst(endTime, 4))
    }, [startTime, endTime, defaultReference, setBottomUser])
    const onPlayFromBeginning = useCallback(() => {
        clearMessages()
        playAudio(Types.to(0), null, setAudioState)
    }, [setAudioState])
    const onStop = useCallback(() => {
        clearMessages()
        stopAudio(setAudioState)
    }, [setAudioState])
    const onPlaySelection = useCallback(() => {
        clearMessages()
        if (!_.isNull(selected) && Types.isValidAnnotation(annotations.current[user][selected])) {
            const ann = annotations.current[user][selected]
            playAudioInMovie(ann.startTime!, ann.endTime!, setAudioState, startTime)
        }
    }, [selected, user])
    const onReplaceWithReference = useCallback(() => {
        clearMessages()
        onStop()
        setAnnotations(prev => ({ ...prev, [user]: prev[bottomUser] }))
    }, [setAnnotations, onStop])
    const onFillWithReference = useCallback(() => {
        clearMessages()
        onStop()
        setAnnotations(prev => {
            const onlyValid = _.filter(prev[user], Types.isValidAnnotation)
            const lastAnnotationEndTime = Types.to<Types.TimeInMovie>(
                _.max(_.concat(-1, _.map(onlyValid, a => Types.from<Types.TimeInMovie>(a.endTime!))))!
            )
            let mergedAnnotations = _.cloneDeep(
                _.concat(
                    onlyValid,
                    // @ts-ignore
                    _.filter(prev[bottomUser], (a: Types.Annotation) => a.startTime > lastAnnotationEndTime)
                )
            )
            _.forEach(mergedAnnotations, (a, k: number) => {
                a.index = k
            })
            return { ...prev, [user]: mergedAnnotations }
        })
    }, [setAnnotations, onStop])
    const onDeleteSelection = useCallback(() => {
        clearMessages()
        if (!_.isNull(selected)) {
            onStop()
            setAnnotations(prev => {
                const previous = previousAnnotation(prev[user], selected)
                const next = nextAnnotation(prev[user], selected)
                if (previous != null) setSelected(previous)
                else if (next != null) setSelected(next)
                else setSelected(null)
                let anns = _.cloneDeep(prev[user])
                anns[selected].startTime = undefined
                anns[selected].endTime = undefined
                return { ...prev, [user]: anns }
            })
        }
    }, [setAnnotations, onStop, selected])

    const onUnselect = useCallback(() => {
        clearMessages()
        setSelected(null)
    }, [selected])

    const onUpdateTranscript = useCallback(
        (newWords: string[]) => {
            clearMessages()
            setSelected(null)
            setAnnotations(prev => {
                const oldWords = _.map(prev[user], a => a.word)
                const oldAnnotations = _.cloneDeep(prev[user])
                const alignment = alignWords(newWords, oldWords)
                let annotations: Types.Annotation[] = []
                _.forEach(newWords, function(word, index) {
                    annotations[index] = { word: word, index: index }
                    if (_.has(alignment, index)) {
                        const old = oldAnnotations[alignment[index]]
                        annotations[index].startTime = old.startTime
                        annotations[index].endTime = old.endTime
                    } else if (oldWords.length == newWords.length) {
                        // If there is no alignment but the number of words is unchanged, then
                        // we replaced one or more words. We preserve the annotations in that
                        // case.
                        const old = oldAnnotations[index]
                        annotations[index].startTime = old.startTime
                        annotations[index].endTime = old.endTime
                    }
                })
                setRedraw({})
                return { ...prev, [user]: annotations }
            })
        },
        [annotations]
    )

    const setClickPositionsFn = useCallback((val: React.SetStateAction<Types.TimeInSegment[]>, clear: boolean) => {
        clearMessages()
        setClickPositions(val)
        if (val.length !== 0 && clear) setSelected(null)
    }, [])

    const onSelectReferece = useCallback(
        (reference: string) => {
            setBottomUser(reference)
        },
        [setBottomUser]
    )

    const setPlaybackRate = useCallback(
        (newRate: 'normal' | 'half') => {
            setAudioState(prev => {
                return { ...prev, playbackRate: newRate }
            })
        },
        [setAudioState]
    )

    useHotkeys(
        'a',
        batched(() => {
            if (audioState.playbackRate === 'half') {
                setPlaybackRate('normal')
                return
            }
            if (audioState.playbackRate === 'normal') {
                setPlaybackRate('half')
                return
            }
        }),
        {},
        [setPlaybackRate, audioState]
    )
    useHotkeys('s', batched(() => onSave.current()), {}, [onSave])
    useHotkeys('shift+b', batched(onBack4s), {}, [onBack4s])
    useHotkeys('b', batched(onBack2s), {}, [onBack2s])
    useHotkeys('f', batched(onForward2s), {}, [onForward2s])
    useHotkeys('shift+f', batched(onForward4s), {}, [onForward4s])
    useHotkeys('p', batched(onPlayFromBeginning), {}, [onPlayFromBeginning])
    useHotkeys('t', batched(onStop), {}, [onStop])
    useHotkeys('up', batched(onPlaySelection), {}, [onPlaySelection])
    useHotkeys('down', batched(onPlaySelection), {}, [onPlaySelection])
    useHotkeys('y', batched(onPlaySelection), {}, [onPlaySelection])
    useHotkeys('c', batched(onUnselect), {}, [onUnselect])
    useHotkeys('d', batched(onDeleteSelection), {}, [onDeleteSelection])
    useHotkeys('w', batched(onStartNextWord), {}, [onStartNextWord])
    useHotkeys('shift+w', batched(onStartWordAfterWord), {}, [onStartWordAfterWord])
    useHotkeys(
        'right',
        () => {
            clearMessages()
            if (selected == null) {
                const firstAnnotation = _.head(_.filter(annotations.current[user], Types.isValidAnnotation))
                if (firstAnnotation) {
                    setSelected(firstAnnotation.index)
                    onPlayIndex(firstAnnotation.index)
                } else {
                    onMessageRef.current!(Types.MessageLevel.warning, "Can't select the first word: no words are annotated")
                    return
                }
            } else {
                const nextAnnotation = _.head(
                    _.filter(_.drop(annotations.current[user], selected + 1), Types.isValidAnnotation)
                )
                if (nextAnnotation) {
                    setSelected(nextAnnotation.index)
                    onPlayIndex(nextAnnotation.index)
                } else {
                    onMessageRef.current!(Types.MessageLevel.warning, 'At the last word, no other annotations to select')
                    return
                }
            }
        },
        {},
        [selected, setSelected]
    )
    useHotkeys(
        'left',
        () => {
            clearMessages()
            if (selected == null) {
                const firstAnnotation = _.last(_.filter(annotations.current[user], Types.isValidAnnotation))
                if (firstAnnotation) {
                    setSelected(firstAnnotation.index)
                    onPlayIndex(firstAnnotation.index)
                } else {
                    onMessageRef.current!(Types.MessageLevel.warning, "Can't select the last word: no words are annotated")
                    return
                }
            } else {
                const nextAnnotation = _.last(_.filter(_.take(annotations.current[user], selected), Types.isValidAnnotation))
                if (nextAnnotation) {
                    setSelected(nextAnnotation.index)
                    onPlayIndex(nextAnnotation.index)
                } else {
                    onMessageRef.current!(Types.MessageLevel.warning, 'At the first word, no other annotations to select')
                    return
                }
            }
        },
        {},
        [selected, setSelected]
    )
    useHotkeys(
        't',
        () => {
            if (transcriptButtonRef.current) transcriptButtonRef.current.click()
        },
        {},
        [onBack4s]
    )

    useHotkeys(
        'shift+left',
        () => {
            if (selected == null) {
                onMessageRef.current!(Types.MessageLevel.warning, "Can't move word beginning, no word selected")
            } else if (!Types.isValidAnnotation(annotations.current[user][selected])) {
                onMessageRef.current!(Types.MessageLevel.warning, 'The current word is not annotated')
            } else {
                let anns = _.cloneDeep(annotations.current[user])
                anns[selected].startTime = Types.subMax(anns[selected].startTime!, keyboardShiftOffset, startTime)
                if (!shouldRejectAnnotationUpdate(anns, anns[selected])) {
                    setAnnotations(prev => ({ ...prev, [user]: anns }))
                }
            }
        },
        {},
        [selected, user]
    )
    useHotkeys(
        'shift+right',
        () => {
            if (selected == null) {
                onMessageRef.current!(Types.MessageLevel.warning, "Can't move word beginning, no word selected")
            } else if (!Types.isValidAnnotation(annotations.current[user][selected])) {
                onMessageRef.current!(Types.MessageLevel.warning, 'The current word is not annotated')
            } else {
                let anns = _.cloneDeep(annotations.current[user])
                anns[selected].startTime = Types.addMin(
                    anns[selected].startTime!,
                    keyboardShiftOffset,
                    Types.sub(anns[selected].endTime!, keyboardShiftOffset)
                )
                if (!shouldRejectAnnotationUpdate(anns, anns[selected])) {
                    setAnnotations(prev => ({ ...prev, [user]: anns }))
                }
            }
        },
        {},
        [selected, user]
    )

    useHotkeys(
        'ctrl+left',
        () => {
            if (selected == null) {
                onMessageRef.current!(Types.MessageLevel.warning, "Can't move word beginning, no word selected")
            } else if (!Types.isValidAnnotation(annotations.current[user][selected])) {
                onMessageRef.current!(Types.MessageLevel.warning, 'The current word is not annotated')
            } else {
                let anns = _.cloneDeep(annotations.current[user])
                anns[selected].endTime = Types.subMax(
                    anns[selected].endTime!,
                    keyboardShiftOffset,
                    Types.add(anns[selected].startTime!, keyboardShiftOffset)
                )
                if (!shouldRejectAnnotationUpdate(anns, anns[selected])) {
                    setAnnotations(prev => ({ ...prev, [user]: anns }))
                }
            }
        },
        {},
        [selected, user]
    )
    useHotkeys(
        'ctrl+right',
        () => {
            if (selected == null) {
                onMessageRef.current!(Types.MessageLevel.warning, "Can't move word beginning, no word selected")
            } else if (!Types.isValidAnnotation(annotations.current[user][selected])) {
                onMessageRef.current!(Types.MessageLevel.warning, 'The current word is not annotated')
            } else {
                let anns = _.cloneDeep(annotations.current[user])
                anns[selected].endTime = Types.addMin(anns[selected].endTime!, keyboardShiftOffset, endTime)
                if (!shouldRejectAnnotationUpdate(anns, anns[selected])) {
                    setAnnotations(prev => ({ ...prev, [user]: anns }))
                }
            }
        },
        {},
        [selected, user]
    )

    useHotkeys(
        'shift+up',
        () => {
            if (selected == null) {
                onMessageRef.current!(Types.MessageLevel.warning, "Can't move word beginning, no word selected")
            } else if (!Types.isValidAnnotation(annotations.current[user][selected])) {
                onMessageRef.current!(Types.MessageLevel.warning, 'The current word is not annotated')
            } else {
                let anns = _.cloneDeep(annotations.current[user])
                anns[selected].startTime = Types.subMax(anns[selected].startTime!, keyboardShiftOffset, startTime)
                anns[selected].endTime = Types.subMax(
                    anns[selected].endTime!,
                    keyboardShiftOffset,
                    Types.add(anns[selected].startTime!, keyboardShiftOffset)
                )
                if (!shouldRejectAnnotationUpdate(anns, anns[selected])) {
                    setAnnotations(prev => ({ ...prev, [user]: anns }))
                }
            }
        },
        {},
        [selected, user]
    )
    useHotkeys(
        'shift+down',
        () => {
            if (selected == null) {
                onMessageRef.current!(Types.MessageLevel.warning, "Can't move word beginning, no word selected")
            } else if (!Types.isValidAnnotation(annotations.current[user][selected])) {
                onMessageRef.current!(Types.MessageLevel.warning, 'The current word is not annotated')
            } else {
                let anns = _.cloneDeep(annotations.current[user])
                anns[selected].startTime = Types.addMin(
                    anns[selected].startTime!,
                    keyboardShiftOffset,
                    Types.sub(anns[selected].endTime!, keyboardShiftOffset)
                )
                anns[selected].endTime = Types.addMin(anns[selected].endTime!, keyboardShiftOffset, endTime)
                if (!shouldRejectAnnotationUpdate(anns, anns[selected])) {
                    setAnnotations(prev => ({ ...prev, [user]: anns }))
                }
            }
        },
        {},
        [selected, user]
    )

    return _.isEmpty(annotationSource.current) ? (
        <Spin size="large" />
    ) : (
            <>
                <SpectrogramWithAnnotations
                    movie={movie}
                    startTime={startTime}
                    endTime={endTime}
                    topAnnotations={annotations.current[user]}
                    setTopAnnotations={setTopAnnotations}
                    bottomAnnotations={annotations.current[bottomUser]}
                    setBottomAnnotations={null}
                    setSelectedTop={setSelected}
                    selectedTop={selected}
                    audioState={audioState}
                    setAudioState={setAudioState}
                    setClickPositions={setClickPositionsFn}
                    clearClickMarker={clearClickMarker}
                />

                <EditorButtons
                    onPlayFromBeginning={onPlayFromBeginning}
                    onStop={onStop}
                    onBack4s={onBack4s}
                    onBack2s={onBack2s}
                    onForward2s={onForward2s}
                    onForward4s={onForward4s}
                    onPlaySelection={onPlaySelection}
                    onReplaceWithReference={onReplaceWithReference}
                    onFillWithReference={onFillWithReference}
                    onDeleteSelection={onDeleteSelection}
                    onUnselect={onUnselect}
                    onStartNextWord={onStartNextWord}
                    onStartWordAfterWord={onStartWordAfterWord}
                />

                <EditorTranscript
                    annotations={annotations.current[user]}
                    selected={selected}
                    setSelected={onWordSelected}
                    setIsLocked={setIsLocked}
                    onUpdateTranscript={onUpdateTranscript}
                    ref={transcriptButtonRef}
                />

                <Row justify="center">
                    <Col>
                        <EditorAudioOptions playbackRate={audioState.playbackRate} setPlaybackRate={setPlaybackRate} />
                    </Col>
                    <Col>
                        <EditorReferenceSelector
                            annotations={annotations.current}
                            references={references}
                            onSelectReferece={onSelectReferece}
                            reference={bottomUser}
                        />
                    </Col>
                </Row>

                <EditorAdvancedButtons
                    movie={movie}
                    setMovie={setMovie}
                    startTime={startTime}
                    setStartTime={setStartTime}
                    endTime={endTime}
                    setEndTime={setEndTime}
                    user={user}
                    setUser={setUser}
                    references={references}
                    setReferences={setReferences}
                    defaultReference={defaultReference}
                    setDefaultReference={setDefaultReference}
                    onMessage={onMessageRef.current!}
                />
            </>
        )
}
